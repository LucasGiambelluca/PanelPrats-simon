import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { agentNode } from '../agent/AgentNode';
import { AgentNode as AgentNodeClass } from '../agent/AgentNode';
import { logger } from '../../utils/logger';

/**
 * AIAgentExecutor (V3) — Wrapper delgado sobre AgentNode
 *
 * Toda la lógica de IA vive en src/core/agent/:
 *  - AgentNode.ts  → Pipeline de 4 pilares
 *  - AgentTools.ts → Contexto genérico (sin acoplamiento a comercio)
 *  - AgentMemory.ts → Ventana deslizante de contexto (memoria conversacional)
 *
 * Este ejecutor solo:
 *  1. Extrae el mensaje del contexto (texto o transcripcion)
 *  2. Llama a AgentNode.process()
 *  3. Mapea el resultado al formato que espera el FlowEngine
 */
export class AIAgentExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, _engine: any): Promise<NodeExecutionResult> {
        // PRIORIDAD:
        // 1. Variable configurada en el nodo (data.inputVariable)
        // 2. user_message (mensaje directo)
        // 3. transcripcion (audio)
        // 4. webhook_raw_message
        const incomingMessage =
            (data.inputVariable ? context[data.inputVariable] : null) ||
            context.user_message ||
            context.transcripcion ||
            context.webhook_raw_message ||
            '';

        // Si no hay mensaje y el nodo tiene una pregunta inicial → esperar
        if (!incomingMessage || incomingMessage.trim() === '') {
            const messages: string[] = [];
            if (data.question?.trim()) {
                const question = data.question.replace(/\{\{([\w\.]+)\}\}/g, (_: string, v: string) =>
                    (context as any)[v] || v
                );
                messages.push(question);
            }
            return { messages, wait_for_input: true };
        }

        const result = await this._process(incomingMessage, data, context);
        return {
            messages: result.messages || [],
            wait_for_input: false,
            conditionResult: result.updatedContext?.respuesta,
            updatedContext: result.updatedContext,
        };
    }

    async handleInput(input: string, data: any, context: ExecutionContext): Promise<{
        updatedContext?: Partial<ExecutionContext>;
        messages?: string[];
        isValidInput?: boolean;
    }> {
        const result = await this._process(input, data, context);
        return { ...result, isValidInput: true };
    }

    // ─── NÚCLEO: delega toda la lógica a AgentNode ────────────────────────────

    private async _process(input: string, data: any, context: ExecutionContext): Promise<{
        updatedContext?: Partial<ExecutionContext>;
        messages?: string[];
        isValidInput?: boolean;
    }> {
        const outputVariable = data.output_variable || 'agent_intent';
        const sessionId = context.sessionId || context.phone || 'default';
        const pushName = context.pushName || context.customer_name || 'Cliente';

        try {
            // Llamar al pipeline de 4 pilares
            const response = await agentNode.process(
                {
                    text: input,
                    transcription: context.transcripcion,
                    clientPhone: context.phone,
                    clientName: pushName,
                    sessionId,
                    apiKey: data.apiKey,   // Key inyectada desde el nodo visual
                    model: data.model,     // Modelo inyectado desde el nodo visual
                },
                data.system_prompt        // Prompt personalizado del nodo visual
            );

            const intentES = AgentNodeClass.mapIntent(response.intent);

            logger.info(`[AIAgentExecutor] ✅ | Intent: ${response.intent} → ${intentES} | Items: ${response.items?.length ?? 0}`);

            // Si el usuario definió una variable de salida, NO mandamos mensajes automáticos
            // permitiendo que el flujo use un nodo de "Mensaje" posterior con la variable.
            const shouldSendAutoMessage = !data.output_variable;

            return {
                updatedContext: {
                    [outputVariable]: intentES,
                    [`${outputVariable}_response`]: response.response,
                    [`${outputVariable}_items`]: response.items ?? [],
                    [`${outputVariable}_address`]: response.address ?? null,
                    [`${outputVariable}_delivery`]: response.delivery_method ?? null,
                    [`${outputVariable}_payment`]: response.payment_method ?? null,
                    [`${outputVariable}_customer_name`]: response.customer_name ?? null,
                    [`${outputVariable}_raw`]: input,
                    respuesta: intentES,
                },
                messages: shouldSendAutoMessage ? [response.response] : [],
                isValidInput: true,
            };
        } catch (err: any) {
            logger.error('[AIAgentExecutor] Pipeline failed', { error: err.message });
            return {
                updatedContext: { [outputVariable]: 'error', respuesta: 'error' },
                messages: [`Hola ${pushName}, tuve un problema. ¿Podés intentarlo de nuevo?`],
                isValidInput: false,
            };
        }
    }
}

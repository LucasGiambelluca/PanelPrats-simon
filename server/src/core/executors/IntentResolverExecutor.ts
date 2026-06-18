import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { AIService } from '../../services/AIService';
import { SupportAgentService } from '../../services/SupportAgentService';
import { logger } from '../../utils/logger';

export class IntentResolverExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        // Send the optional question prompt if defined, and wait for classification input
        const messages = [];
        if (data.question && data.question.trim().length > 0) {
            // Interpolate variables in the question
            const question = data.question.replace(/\{\{([\w\.]+)\}\}/g, (_: string, varName: string) => {
                return (context as any)[varName] || varName;
            });
            messages.push(question);
        }

        return {
            messages,
            wait_for_input: true
        };
    }

    async handleInput(input: string, data: any, context: ExecutionContext): Promise<{ updatedContext?: Partial<ExecutionContext>; messages?: string[]; isValidInput?: boolean; }> {
        const outputVariable = data.output_variable || 'intent_clasificado';
        const possibleIntents = (data.possible_intents || '').split(',').map((s: string) => s.trim().toLowerCase()).filter(Boolean);
        const fallbackMessage = data.fallback_message || 'No te entendí bien, ¿podés expresarlo de otra forma?';
        const maxRetries = data.max_retries || 2;
        const retryKey = `${outputVariable}_retries`;
        const currentRetries = (context[retryKey] as number) || 0;

        if (possibleIntents.length === 0) {
            logger.warn(`[IntentResolverExecutor] No possible_intents defined for variable ${outputVariable}`);
            return {
                updatedContext: { [outputVariable]: 'error' },
                isValidInput: true
            };
        }

        // Build the precise prompt for Groq as referee
        let systemPrompt = data.system_prompt || `Sos el motor de clasificación de intenciones de un asistente virtual.
Tu única tarea es leer lo que dice el usuario y clasificarlo ESTRICTAMENTE en UNO de los siguientes intents permitidos:
[ ${possibleIntents.join(' | ')} | no_entendido ]

Reglas:
- Si el mensaje coincide con la idea de alguno de los intents, devolvé SOLO la palabra clave exacta en minúsculas, sin puntuación ni texto extra.
- Si el mensaje es completamente ambiguo, no tiene sentido en el contexto actual, o el usuario balbucea, devolvé 'no_entendido'.
- NUNCA devuelvas texto conversacional.`;

        // 1. Interpolate variables: {{varName}} in systemPrompt
        systemPrompt = systemPrompt.replace(/\{\{([\w\.]+)\}\}/g, (_: string, varName: string) => {
            return (context as any)[varName] || '';
        });

        let contextString = '';
        if (data.context_variables && Array.isArray(data.context_variables)) {
            const contextData = data.context_variables.reduce((acc: any, key: string) => {
                if (context[key]) acc[key] = context[key];
                return acc;
            }, {});
            contextString = `\nContexto actual del flujo:\n${JSON.stringify(contextData)}`;
        }

        let userPromptTemplate = data.user_prompt || `El usuario respondió: "{{input}}"${contextString}\n\nClasificá su intención devolviendo SOLO la palabra clave.`;

        // 2. Interpolate variables in userPromptTemplate
        let userMessage = userPromptTemplate.replace(/\{\{([\w\.]+)\}\}/g, (_: string, varName: string) => {
            if (varName === 'input' || varName === 'raw_user_message') return input;
            return (context as any)[varName] || '';
        });

        // Resolver la API key: la del nodo, o la config IA de la cuenta (ai_api_key).
        // Sin esto AIService cae a la key de env (que no tiene saldo).
        let apiKey = data.apiKey;
        let model = data.model;
        if (!apiKey && (context as any).accountId) {
            try {
                const { config } = await SupportAgentService.loadAccountContext((context as any).accountId);
                apiKey = config.apiKey;
                model = model || config.model;
            } catch { /* sin config → AIService usa su fallback */ }
        }

        try {
            logger.info(`[IntentResolverExecutor] Clasificando intención para: "${input}"`);

            let response = await AIService.complete({
                systemPrompt,
                userMessage,
                temperature: 0.2, // Low temperature for deterministic classification
                maxTokens: 10,
                apiKey,
                model
            });

            response = response.trim().toLowerCase().replace(/[^\w]/g, ''); // Clean result

            if (response === 'no_entendido' || !possibleIntents.includes(response)) {
                logger.info(`[IntentResolverExecutor] Intent unrecognized ("${response}"). Retries: ${currentRetries + 1}/${maxRetries}`);
                if (currentRetries + 1 >= maxRetries) {
                    // Fail completely, send signal to handover or fallback
                    return {
                        updatedContext: {
                            [outputVariable]: 'handover', // or fallback
                            [retryKey]: 0
                        },
                        messages: ['Lo siento, sigo sin poder entenderte. ⚠️'],
                        isValidInput: true // Allow advancement so it can be handled by a condition Node
                    };
                } else {
                    // Retry prompt
                    return {
                        updatedContext: { [retryKey]: currentRetries + 1 },
                        messages: [fallbackMessage],
                        isValidInput: false // Block advancement
                    };
                }
            }

            // Success match
            logger.info(`[IntentResolverExecutor] Successfully matched intent: "${response}"`);
            return {
                updatedContext: {
                    [outputVariable]: response,
                    [retryKey]: 0,
                    raw_user_message: input // Store user's message for downstream nodes
                },
                isValidInput: true
            };

        } catch (err: any) {
            logger.error(`[IntentResolverExecutor] Arbitration failed`, { error: err.message });
            return {
                updatedContext: { [outputVariable]: 'error' },
                messages: ['Oops, tuve un pequeño problema procesando tu mensaje. Intentémoslo de nuevo.'],
                isValidInput: false
            };
        }
    }
}

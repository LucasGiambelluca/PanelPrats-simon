import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { AIService } from '../../services/AIService';
import { logger } from '../../utils/logger';

/**
 * GroqExecutor: Calls Groq AI to generate a response or process data within a flow.
 * Supports variable interpolation in the prompt.
 */
export class GroqExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        let prompt = data.prompt || '';
        let systemPrompt = data.systemPrompt || 'Sos un asistente virtual para una rotisería.';
        const targetVariable = data.variable || 'ai_response';

        if (!prompt) {
            return {
                messages: ['⚠️ Error: Nodo Groq sin instrucción (prompt).'],
                wait_for_input: false
            };
        }

        // 1. Interpolate variables: {{varName}} in BOTH prompts
        const interpolate = (text: string) => text.replace(/\{\{([\w\.]+)\}\}/g, (_: string, varName: string) => {
            return (context as any)[varName] || '';
        });

        prompt = interpolate(prompt);
        systemPrompt = interpolate(systemPrompt);

        try {
            logger.info(`[GroqExecutor] Calling Groq with prompt: "${prompt.substring(0, 50)}..."`);

            const response = await AIService.complete({
                systemPrompt,
                userMessage: prompt,
                temperature: data.temperature ?? 0.7,
                maxTokens: data.maxTokens ?? 512
            });

            // 2. Detect [VOLVER_FLUJO] tag
            const hasVolverFlujo = response.includes('[VOLVER_FLUJO]');
            const cleanResponse = response.replace('[VOLVER_FLUJO]', '').trim();

            // 3. Return result
            return {
                messages: data.silent ? [] : [cleanResponse],
                wait_for_input: data.wait_for_input ?? false,
                updatedContext: {
                    [targetVariable]: cleanResponse,
                    last_ai_completed: hasVolverFlujo
                }
            };
        } catch (err: any) {
            logger.error(`[GroqExecutor] Execution failed`, { error: err.message });
            return {
                messages: ['⚠️ Lo siento, mi cerebro de IA tuvo un problema temporal.'],
                wait_for_input: false
            };
        }
    }

    async handleInput(input: string, data: any, context: ExecutionContext): Promise<{ updatedContext?: Partial<ExecutionContext>; messages?: string[]; isValidInput?: boolean; }> {
        // If we were waiting for input, it means we are in a chat loop.
        // We return valid input so the engine advances (likely back to this same node if looped).
        return {
            isValidInput: true,
            updatedContext: {
                raw_user_message: input // Update the message for the next execution
            }
        };
    }
}

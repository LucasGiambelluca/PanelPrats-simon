import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

export class MessageExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        // Interpolación básica de variables si es necesario: Hola {{nombre}}
        let content = data.message || data.text || '';

        // Simple regex replace for {{variables}}
        content = content.replace(/\{\{(\w+)\}\}/g, (_: string, varName: string) => {
            return context[varName] || '';
        });

        return {
            messages: [content],
            wait_for_input: false,
            // messageNode usually just sends and moves on
        };
    }
}

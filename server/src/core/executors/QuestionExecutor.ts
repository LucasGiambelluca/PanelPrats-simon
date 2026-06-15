import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

export class QuestionExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        // Solo salteamos si explícitamente se permite en el nodo Y ya tiene valor
        if (data.allow_skip && data.variable && context[data.variable]) {
            console.log(`[QuestionExecutor] Saltando pregunta '${data.name}' porque allow_skip es true y ${data.variable} ya tiene valor.`);
            return { messages: [], wait_for_input: false };
        }

        // Si no, enviamos la pregunta y esperamos
        return {
            messages: [data.question],
            wait_for_input: true
            // El input se guardará en flow.engine.ts al recibirlo, usando data.variable
        };
    }
}

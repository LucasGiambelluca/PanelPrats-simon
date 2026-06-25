import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

/** Reemplaza {{variable}} con el valor del contexto (vacío si no existe). */
function interpolate(text: string, context: any): string {
    if (typeof text !== 'string') return text;
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, v) => {
        const val = (context as any)[v];
        return val === undefined || val === null ? '' : String(val);
    });
}

export class QuestionExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext, engine: any): Promise<NodeExecutionResult> {
        // Solo salteamos si explícitamente se permite en el nodo Y ya tiene valor
        if (data.allow_skip && data.variable && context[data.variable]) {
            console.log(`[QuestionExecutor] Saltando pregunta '${data.name}' porque allow_skip es true y ${data.variable} ya tiene valor.`);
            return { messages: [], wait_for_input: false };
        }

        // Enviamos la pregunta (interpolando {{nombre}} etc.) y esperamos el input.
        return {
            messages: [interpolate(data.question, context)],
            wait_for_input: true
            // El input se guardará en flow.engine.ts al recibirlo, usando data.variable
        };
    }
}

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
        // Si ya tenemos el dato (vino de otro flujo vía "Ir a Flujo" / namespace compartido,
        // o se preguntó antes), NO lo volvemos a pedir. Para forzar re-preguntar, poné
        // allow_skip = false en el nodo.
        const existing = data.variable ? (context as any)[data.variable] : undefined;
        if (data.allow_skip !== false && data.variable && existing !== undefined && existing !== null && String(existing).trim() !== '') {
            console.log(`[QuestionExecutor] Saltando '${data.variable}': ya tiene valor "${existing}".`);
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

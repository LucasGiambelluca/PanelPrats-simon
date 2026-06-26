import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

/**
 * Nodo "Capturar Variable": lee una variable que viene de otro flujo (vía el nodo
 * "Ir a Flujo" con variables a pasar, o del namespace compartido) y la deja disponible
 * en el flujo actual. Opcionalmente la renombra (outputVariable) o le pone un default.
 *
 * data: {
 *   variable: string,          // variable a capturar (ej. 'nombre')
 *   outputVariable?: string,   // nombre local (default = variable)
 *   defaultValue?: string      // valor si no vino nada
 * }
 * Pass-through: no manda mensajes, no espera input.
 */
export class CaptureVarExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const src = String(data.variable || '').trim();
        const out = String(data.outputVariable || src).trim();
        let val: any = src ? (context as any)[src] : undefined;
        if ((val === undefined || val === null || val === '') && data.defaultValue !== undefined && data.defaultValue !== '') {
            val = data.defaultValue;
        }
        const updatedContext: any = {};
        if (out && val !== undefined && val !== null) updatedContext[out] = val;
        return { messages: [], wait_for_input: false, updatedContext };
    }
}

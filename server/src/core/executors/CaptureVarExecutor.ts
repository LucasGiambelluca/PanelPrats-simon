import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';

function interpolate(text: string, ctx: any): string {
    if (typeof text !== 'string') return text;
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, v) => {
        const x = ctx?.[v];
        return x === undefined || x === null ? '' : String(x);
    });
}

/**
 * Nodo "Capturar Variable": deja una variable disponible en el flujo actual.
 * Tres modos (en orden de prioridad):
 *  - `value`: plantilla con {{vars}} → guarda el texto interpolado (p.ej. armar un resumen).
 *  - `variable`: copia esa variable (renombra con outputVariable; default si no vino).
 *  - `transform: 'edad'`: si el valor es un año (1900–actual), lo convierte a edad.
 *
 * data: { variable?, outputVariable?, defaultValue?, value?, transform? }
 * Pass-through: no manda mensajes, no espera input.
 */
export class CaptureVarExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const src = String(data.variable || '').trim();
        const out = String(data.outputVariable || src || 'captured').trim();
        let val: any;

        if (data.value !== undefined && data.value !== '') {
            // Plantilla: arma un texto con otras variables (ej. resumen de la cita).
            val = interpolate(String(data.value), context);
        } else {
            val = src ? (context as any)[src] : undefined;
            if ((val === undefined || val === null || val === '') && data.defaultValue !== undefined && data.defaultValue !== '') {
                val = data.defaultValue;
            }
        }

        // Transform opcional: año de nacimiento → edad.
        if (data.transform === 'edad' && val !== undefined && val !== null) {
            const m = String(val).match(/\b(19\d{2}|20\d{2})\b/);
            if (m) {
                const year = parseInt(m[1], 10);
                const nowYear = new Date(Date.now() - 3 * 3600000).getUTCFullYear(); // AR
                if (year >= 1900 && year <= nowYear) val = String(nowYear - year);
            } else {
                const n = String(val).match(/\d{1,3}/);
                if (n) val = n[0]; // deja solo el número de edad ("tengo 60 años" → "60")
            }
        }

        const updatedContext: any = {};
        if (out && val !== undefined && val !== null) updatedContext[out] = val;
        return { messages: [], wait_for_input: false, updatedContext };
    }
}

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

        // Transform opcional: convierte año de nacimiento → edad. Soporta:
        //  - año de 4 dígitos: "1967" / "soy de 1967" → edad.
        //  - año de 2 dígitos con contexto: "soy del 67" / "nací en el 67" / "del 67" → 1967.
        //  - edad directa: "60" / "tengo 60 años" → 60.
        if (data.transform === 'edad' && val !== undefined && val !== null) {
            const s = String(val).toLowerCase();
            const nowYear = new Date(Date.now() - 3 * 3600000).getUTCFullYear(); // AR
            const pivot = nowYear % 100; // p.ej. 26 → "67" es 1967, "05" es 2005
            const y4 = s.match(/\b(19\d{2}|20\d{2})\b/);
            const yCtx = s.match(/(?:del|de los|nací|naci|nacida|nacido|año|anio)\s*(?:en\s*|el\s*|de\s*)?'?(\d{2})\b/);
            if (y4) {
                const year = parseInt(y4[1], 10);
                if (year <= nowYear) val = String(nowYear - year);
            } else if (yCtx) {
                const yy = parseInt(yCtx[1], 10);
                const fullYear = yy > pivot ? 1900 + yy : 2000 + yy;
                val = String(nowYear - fullYear);
            } else {
                const n = s.match(/\d{1,3}/);
                if (n) val = n[0]; // edad directa
            }
        }

        const updatedContext: any = {};
        if (out && val !== undefined && val !== null) updatedContext[out] = val;
        return { messages: [], wait_for_input: false, updatedContext };
    }
}

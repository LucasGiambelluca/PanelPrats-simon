import { NodeExecutor, NodeExecutionResult, ExecutionContext } from './types';
import { AIService } from '../../services/AIService';
import { SupportAgentService } from '../../services/SupportAgentService';
import { logger } from '../../utils/logger';

function interpolate(text: string, ctx: any): string {
    if (typeof text !== 'string') return text;
    return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, v) => {
        const x = ctx?.[v];
        return x === undefined || x === null ? '' : String(x);
    });
}

/**
 * Nodo que pregunta el nombre y, vía IA, clasifica el género (hombre / mujer /
 * desconocido). El resultado se guarda en `outputVariable` (default 'genero') y el
 * motor lo usa como handle de salida para rutear (igual que intentResolverNode).
 *
 * data: {
 *   question?: string,        // prompt para pedir el nombre (default "¿Cómo te llamás?")
 *   variable?: string,        // dónde guardar el nombre (default 'nombre')
 *   outputVariable?: string,  // dónde guardar el género (default 'genero')
 *   apiKey?, model?           // opcional; si no, usa la config de la cuenta / env
 * }
 * Salidas (sourceHandle de las edges): 'hombre' | 'mujer' | 'desconocido'.
 */
export class GenderExecutor implements NodeExecutor {
    async execute(data: any, context: ExecutionContext): Promise<NodeExecutionResult> {
        const question = data.question || '¿Cómo te llamás?';
        return { messages: [interpolate(question, context)], wait_for_input: true };
    }

    async handleInput(input: string, data: any, context: ExecutionContext): Promise<{ updatedContext?: Partial<ExecutionContext>; messages?: string[]; isValidInput?: boolean; }> {
        const nameVar = (data.variable || 'nombre').trim();
        const outVar = (data.outputVariable || data.output_variable || 'genero').trim();
        const firstName = String(input || '').trim().split(/\s+/)[0] || String(input || '');

        // Resolver la API key: la del nodo, o la config IA de la cuenta, o la de env.
        let apiKey = data.apiKey;
        let model = data.model;
        if (!apiKey && (context as any).accountId) {
            try {
                const { config } = await SupportAgentService.loadAccountContext((context as any).accountId);
                apiKey = config.apiKey;
                model = model || config.model;
            } catch { /* sin config → AIService usa su fallback (env) */ }
        }

        let genero = 'desconocido';
        try {
            const resp = await AIService.complete({
                systemPrompt: 'Sos un clasificador de género por nombre de pila (español/Argentina). Respondé SOLO una palabra exacta en minúsculas: "hombre", "mujer" o "desconocido". Sin puntuación ni texto extra.',
                userMessage: `Nombre de pila: "${firstName}". ¿La persona es hombre o mujer?`,
                temperature: 0,
                maxTokens: 3,
                apiKey,
                model,
            });
            const r = (resp || '').trim().toLowerCase().replace(/[^a-z]/g, '');
            if (r === 'hombre' || r === 'mujer') genero = r;
            logger.info(`[GenderExecutor] "${firstName}" → ${genero}`);
        } catch (e: any) {
            logger.warn(`[GenderExecutor] clasificación falló para "${firstName}": ${e?.message ?? e}`);
        }

        return {
            updatedContext: { [nameVar]: input, [`${nameVar}_raw`]: input, [outVar]: genero } as any,
            isValidInput: true,
        };
    }
}

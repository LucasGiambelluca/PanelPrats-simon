// ─── SupportAgentService ──────────────────────────────────────────────────────
// Agente IA de soporte GLOBAL. Interviene cuando un mensaje no matchea ningún
// flujo (off-script) o cuando el usuario responde algo inesperado dentro de un
// flujo. Entiende la intención y decide:
//   - 'route'   → mandar al usuario al flujo cuyo propósito coincide (por trigger)
//   - 'handoff' → derivar a un humano (no se pudo mapear con confianza)
//   - 'none'    → no hay config/IA disponible; el router mantiene el comportamiento actual
//
// Config (key/model/prompt): primero columnas `ai_*` de la cuenta (migración 0008);
// si no existen, cae al nodo Agente IA de algún flujo activo (la key vive en el nodo).

import { supabase } from '../config/supabase';
import { AIService } from './AIService';
import { logger } from '../utils/logger';

export interface SupportDecision {
    action: 'route' | 'handoff' | 'none';
    trigger?: string;   // trigger del flujo destino (cuando action='route')
    flowName?: string;
    reason?: string;
}

interface SupportConfig {
    apiKey?: string;
    model?: string;
    prompt?: string;
}

interface FlowOption {
    id: string;
    name: string;
    trigger: string;     // primer trigger_word del flujo (normalizado para reingreso)
}

const DEFAULT_SUPPORT_PROMPT =
    'Sos un asistente de soporte. Tu trabajo es entender qué necesita el usuario y derivarlo al flujo de atención correcto, aunque escriba distinto a lo esperado.';

export class SupportAgentService {
    /**
     * Resuelve qué hacer con un mensaje off-script / inesperado.
     */
    static async resolve(params: {
        accountId: string;
        text: string;
        pushName?: string;
    }): Promise<SupportDecision> {
        const { accountId, text } = params;
        if (!text || !text.trim()) return { action: 'none' };

        const { flows, config } = await SupportAgentService.loadAccountContext(accountId);

        if (!config.apiKey) {
            logger.info('[SupportAgent] sin API key disponible (ni cuenta ni nodo) → none');
            return { action: 'none' };
        }
        if (flows.length === 0) {
            // No hay flujos a los que rutear → derivar a humano directamente.
            return { action: 'handoff', reason: 'no hay flujos activos' };
        }

        const menu = flows
            .map((f, i) => `${i + 1}. trigger="${f.trigger}" — ${f.name}`)
            .join('\n');

        const systemPrompt = `${config.prompt || DEFAULT_SUPPORT_PROMPT}

Tenés estos flujos de atención disponibles (cada uno se activa con su "trigger"):
${menu}

El usuario escribió un mensaje que NO encaja en el paso actual de la conversación.
Tu tarea: entender su intención y elegir el flujo más adecuado.

Respondé ÚNICAMENTE con JSON válido, sin texto extra:
{ "action": "route" | "handoff", "trigger": "<el trigger exacto del flujo elegido, o null>" }

REGLAS:
- "route": si la intención del usuario encaja claramente con uno de los flujos. Poné en "trigger" el valor EXACTO de ese flujo (tal cual aparece arriba).
- "handoff": si pide hablar con una persona, está molesto/frustrado, o su intención NO encaja con ningún flujo. En ese caso "trigger" = null.
- Ante la duda entre dos flujos, elegí el más específico. Si no hay ninguno razonable, usá "handoff".`;

        let parsed: { action?: string; trigger?: string | null } | null = null;
        try {
            parsed = await AIService.extractJSON<{ action: string; trigger: string | null }>({
                systemPrompt,
                userMessage: text,
                jsonMode: true,
                temperature: 0.1,
                maxTokens: 200,
                apiKey: config.apiKey,
                model: config.model,
            });
        } catch (err: any) {
            logger.warn('[SupportAgent] fallo la IA', { error: err.message });
            return { action: 'handoff', reason: 'error IA' };
        }

        if (!parsed || parsed.action === 'handoff' || !parsed.trigger) {
            return { action: 'handoff', reason: parsed?.action === 'handoff' ? 'IA decidió handoff' : 'sin trigger' };
        }

        // Validar que el trigger devuelto corresponda a un flujo real (anti-alucinación).
        const wantedTrigger = String(parsed.trigger).trim().toLowerCase();
        const match = flows.find(f => f.trigger.toLowerCase() === wantedTrigger);
        if (!match) {
            logger.info(`[SupportAgent] trigger "${wantedTrigger}" no corresponde a ningún flujo → handoff`);
            return { action: 'handoff', reason: 'trigger inválido' };
        }

        logger.info(`[SupportAgent] route → flujo "${match.name}" (trigger="${match.trigger}")`);
        return { action: 'route', trigger: match.trigger, flowName: match.name };
    }

    /**
     * Carga flujos activos (como menú de ruteo) y la config IA de la cuenta.
     */
    private static async loadAccountContext(accountId: string): Promise<{ flows: FlowOption[]; config: SupportConfig }> {
        const config: SupportConfig = {};

        // 1. Config a nivel cuenta (columnas ai_* — migración 0008). Tolerante si no existen.
        try {
            const { data: acc } = await supabase
                .from('accounts')
                .select('ai_support_enabled, ai_api_key, ai_model, ai_support_prompt')
                .eq('id', accountId)
                .maybeSingle();
            if (acc && (acc as any).ai_support_enabled && (acc as any).ai_api_key) {
                config.apiKey = (acc as any).ai_api_key;
                config.model = (acc as any).ai_model || 'gpt-4o-mini';
                config.prompt = (acc as any).ai_support_prompt || undefined;
            }
        } catch (_) {
            // columnas inexistentes → seguimos con fallback al nodo
        }

        // 2. Flujos activos del cuenta.
        const { data: rows } = await supabase
            .from('flows')
            .select('id, name, trigger_word, is_active, nodes')
            .eq('account_id', accountId)
            .eq('is_active', true);

        const flows: FlowOption[] = [];
        for (const f of rows || []) {
            const firstTrigger = String(f.trigger_word || '')
                .split(',')[0]
                .trim();
            // Excluir wildcard/catch-all y flujos sin trigger usable.
            if (firstTrigger && firstTrigger !== '*') {
                flows.push({ id: f.id, name: f.name || firstTrigger, trigger: firstTrigger });
            }

            // Fallback de config: primera apiKey de un nodo Agente IA.
            if (!config.apiKey) {
                const aiNode = (f.nodes || []).find(
                    (n: any) => n.type === 'aiAgentNode' && typeof n.data?.apiKey === 'string' && n.data.apiKey.startsWith('sk-')
                );
                if (aiNode) {
                    config.apiKey = aiNode.data.apiKey;
                    config.model = aiNode.data.model?.includes('gpt') ? aiNode.data.model : 'gpt-4o-mini';
                }
            }
        }

        return { flows, config };
    }
}

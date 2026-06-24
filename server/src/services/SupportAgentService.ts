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
    action: 'answer' | 'route' | 'handoff' | 'none';
    reply?: string;     // texto en rol (cuando action='answer')
    trigger?: string;   // trigger del flujo destino (cuando action='route')
    flowName?: string;
    reason?: string;
}

export interface SupportConfig {
    apiKey?: string;
    model?: string;
    prompt?: string;
    businessContext?: string;
}

export interface FlowOption {
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
        phone?: string;
    }): Promise<SupportDecision> {
        const { accountId, text, phone } = params;
        if (!text || !text.trim()) return { action: 'none' };

        const { flows, config } = await SupportAgentService.loadAccountContext(accountId);

        // Historial reciente para que el conductor SIGA el hilo (sin esto era stateless:
        // veía cada mensaje aislado, repetía empatía y reseteaba el contexto).
        let history = '';
        if (phone) {
            try {
                const { data: hist } = await supabase
                    .from('whatsapp_messages')
                    .select('direction, content, created_at')
                    .eq('account_id', accountId)
                    .eq('phone', phone)
                    .order('created_at', { ascending: false })
                    .limit(10);
                if (hist?.length) {
                    history = hist
                        .reverse()
                        .map((m: any) => `${m.direction === 'INBOUND' ? 'Cliente' : 'Asistente'}: ${(m.content || '').replace(/\s+/g, ' ').slice(0, 220)}`)
                        .join('\n');
                }
            } catch { /* sin historial: seguimos con solo el mensaje actual */ }
        }

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

        const ctx = (config.businessContext || '').trim();
        const systemPrompt = `${config.prompt || DEFAULT_SUPPORT_PROMPT}

Tenés estos flujos de atención disponibles (cada uno se activa con su "trigger"):
${menu}

DATOS DEL ESTUDIO (única fuente para responder preguntas generales):
${ctx || '(no hay datos cargados)'}
${history ? `\nCONVERSACIÓN HASTA AHORA (seguí el hilo; NO reinicies, NO repitas saludos, NO vuelvas a preguntar lo ya dicho):\n${history}\n` : ''}
El usuario escribió un último mensaje. Considerando TODA la conversación de arriba, decidí UNA acción y respondé SOLO con JSON válido:
{ "action": "answer" | "route" | "handoff", "reply": "<texto o null>", "trigger": "<trigger exacto o null>" }

REGLAS (en orden de prioridad):
1. "route" es la acción PRINCIPAL. Si el mensaje o la conversación tratan de un tema/gestión que coincide con el PROPÓSITO de algún flujo de la lista —aunque el cliente lo diga con palabras coloquiales, sinónimos, errores de tipeo o con emoción—, action="route" con el "trigger" EXACTO de ese flujo. Mapeá por SIGNIFICADO, no por la palabra literal del trigger. Ejemplos de mapeo:
   • "me echaron" / "me despidieron" / "me rajaron" / "quiero mi indemnización" / "cuánto me corresponde por el trabajo" → flujo laboral/despido.
   • "me quiero jubilar" / "tengo X años de aportes" / "trámite de ANSES" → flujo de jubilación.
   • "tuve un choque" / "accidente de auto" / "me chocaron" → accidente de tránsito.
   • "me lastimé en el trabajo" / "accidente laboral" / "ART" → ART.
   • "falleció mi marido y cobraba" / "pensión" → pensión por viudez.
2. "answer": SOLO si NINGÚN flujo aplica al tema y es una consulta general respondible con los DATOS DEL ESTUDIO (horarios, dirección, qué hacen). En "reply": voseo argentino, humano, breve, máx 1 emoji, sin repetir lo ya dicho. Una empatía corta está bien PERO si hay flujo relacionado, igual RUTEÁ (no te quedes solo charlando).
3. "handoff": pide una persona, está muy molesto, o no podés ni rutear ni responder. "trigger"=null.
NUNCA inventes datos que no estén arriba. NUNCA reinicies con un saludo si ya venían hablando. Ante la duda entre answer y route cuando hay un flujo relacionado, elegí SIEMPRE route.`;

        let parsed: { action?: string; trigger?: string | null; reply?: string | null } | null = null;
        try {
            parsed = await AIService.extractJSON<{ action: string; trigger: string | null; reply?: string | null }>({
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

        if (!parsed || !parsed.action) {
            return { action: 'handoff', reason: 'IA sin respuesta' };
        }
        logger.info(`[SupportAgent] decisión IA: action=${parsed.action} trigger=${parsed.trigger ?? '-'}`);

        // answer: validar que haya contexto (anti-alucinación) y reply no vacío.
        if (parsed.action === 'answer') {
            const reply = String((parsed as any).reply || '').trim();
            if (!ctx || !reply) {
                return { action: 'handoff', reason: 'answer sin contexto/reply' };
            }
            return { action: 'answer', reply };
        }

        if (parsed.action === 'handoff' || !parsed.trigger) {
            return { action: 'handoff', reason: parsed.action === 'handoff' ? 'IA decidió handoff' : 'sin trigger' };
        }

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
     * Público para que el SupervisorService reuse la misma resolución de config.
     */
    static async loadAccountContext(accountId: string): Promise<{ flows: FlowOption[]; config: SupportConfig }> {
        const config: SupportConfig = {};

        // 1. Config a nivel cuenta (columnas ai_* — migración 0008). Tolerante si no existen.
        let acc: any = null;
        try {
            acc = (await supabase
                .from('accounts')
                .select('ai_support_enabled, ai_api_key, ai_model, ai_support_prompt, business_context')
                .eq('id', accountId)
                .maybeSingle()).data;
            if (acc && (acc as any).ai_support_enabled && (acc as any).ai_api_key) {
                config.apiKey = (acc as any).ai_api_key;
                config.model = (acc as any).ai_model || 'gpt-4o-mini';
                config.prompt = (acc as any).ai_support_prompt || undefined;
                config.businessContext = (acc as any).business_context || undefined;
            }
        } catch (_) {
            // columnas inexistentes → seguimos con fallback al nodo
            acc = null;
        }

        // business_context puede existir aunque ai_support_enabled sea false.
        if (acc && (acc as any).business_context && !config.businessContext) {
            config.businessContext = (acc as any).business_context;
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

// ─── AgentNode (Panel genérico) ───────────────────────────────────────────────
// Pipeline de 4 pilares portado desde StockSystem, generalizado para el panel
// multicuenta. Combina:
//  - AIService (Groq → Gemini fallback automático)
//  - AgentMemory (singleton persistente por proceso, memoria conversacional)
//  - AgentTools (GENERALIZADO: sin catálogo/pedidos/horarios de comercio)
//
// El agente queda como "LLM con memoria conversacional": la carga de contexto
// de comercio fue reemplazada por contexto vacío (ver AgentTools.ts). El system
// prompt puede inyectarse por nodo (data.system_prompt → customSystemPrompt).

import { AIService } from '../../services/AIService';
import { logger } from '../../utils/logger';
import { agentMemory } from './AgentMemory';
import { loadToolsContext, formatToolsForPrompt, resolveItems } from './AgentTools';
import type {
    AgentInput,
    AgentResponse,
    IntentType,
    AgentNodeState,
    PillarState,
    ToolsContext,
} from './AgentTypes';
import { INTENT_MAP } from './AgentTypes';

// ─── Prompt base del sistema (genérico) ────────────────────────────────────────
// Default neutral: el panel no asume un negocio concreto. Cada nodo puede
// sobreescribirlo con su propio system_prompt.

const DEFAULT_SYSTEM_PROMPT = `
Eres un asistente virtual conversacional. Tu objetivo es ayudar al usuario de forma clara y amable.`;

// ─── Contrato de intents (OBLIGATORIO) ─────────────────────────────────────────
// Se anexa SIEMPRE al prompt, incluso si el nodo define su propio system_prompt.
// Garantiza que el formato JSON y la detección de HANDOFF/FALLBACK no dependan
// de que el prompt personalizado los mencione.
const INTENT_CONTRACT = `
--- CONTRATO DE RESPUESTA (OBLIGATORIO) ---
Respondé ÚNICAMENTE con un objeto JSON válido, sin texto antes ni después:
{ "intent": "<INTENT>", "response": "<texto en español para el usuario>" }

INTENTS POSIBLES:
- GREETING: el usuario saluda.
- INQUIRY: consulta información.
- ORDER: quiere realizar una acción/pedido.
- CHECKOUT: quiere confirmar/pagar.
- CANCEL: quiere cancelar.
- HANDOFF: el usuario pide hablar con una persona, rechaza al bot ("no quiero hablar con robots", "quiero un humano", "pasame con alguien"), está molesto/frustrado, o plantea un tema FUERA de tu alcance que no podés resolver (ej: "quiero jubilarme"). En "response" reconocé brevemente lo que dijo y avisá que lo derivás con una persona.
- FALLBACK: no entendés el mensaje; pedí amablemente que lo reformule.

REGLAS:
1. Si dudás entre FALLBACK y HANDOFF, y el tema está claramente fuera de lo que podés resolver, usá HANDOFF.
2. "response" siempre breve y amable.
3. Nunca inventes información que no esté en el contexto provisto.`;

const FALLBACK_RESPONSE: AgentResponse = {
    intent: 'FALLBACK',
    response: 'Disculpá, en este momento tengo los servicios de IA saturados. ¿Podés intentarlo de nuevo en un momento? 😊',
};

// ─── Parser JSON robusto (Pilar 3) ────────────────────────────────────────────

function parseAgentResponse(raw: string): AgentResponse {
    // Intento 1: parse directo
    try {
        const parsed = JSON.parse(raw);
        if (parsed.intent && parsed.response) return parsed as AgentResponse;
    } catch (_) {}

    // Intento 2: extraer bloque JSON con regex (más flexible con bloques de código markdown)
    try {
        const jsonMatch = raw.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/) ||
                         raw.match(/(\{[\s\S]*"intent"[\s\S]*"response"[\s\S]*\})/);

        if (jsonMatch) {
            const cleanJson = jsonMatch[1].trim();
            const parsed = JSON.parse(cleanJson);
            if (parsed.intent && parsed.response) return parsed as AgentResponse;
        }
    } catch (_) {}

    // Intento 3: reparar JSON truncado
    try {
        let repaired = raw.trim();
        if (!repaired.endsWith('}')) repaired += '"}';
        const parsed = JSON.parse(repaired);
        if (parsed.intent && parsed.response) return parsed as AgentResponse;
    } catch (_) {}

    logger.warn('[AgentNode] JSON parse failed after 3 attempts, using FALLBACK');
    return FALLBACK_RESPONSE;
}

// ─── AgentNode Principal ──────────────────────────────────────────────────────

export class AgentNode {
    private onStateChange?: (state: AgentNodeState) => void;
    private currentState: AgentNodeState;

    constructor(onStateChange?: (state: AgentNodeState) => void) {
        this.onStateChange = onStateChange;
        this.currentState = this.buildInitialState();
    }

    private buildInitialState(): AgentNodeState {
        return {
            status: 'idle',
            activeIntent: null,
            pillars: [
                { id: 'capture',  label: '① Captura dinámica', sublabel: 'texto ó transcripcion', status: 'idle' },
                { id: 'tools',    label: '② Superpoderes',     sublabel: 'contexto genérico', status: 'idle' },
                { id: 'json',     label: '③ Formato JSON',     sublabel: 'intent · response · items', status: 'idle' },
                { id: 'resolver', label: '④ Resolución',       sublabel: 'findProductWithScore (Jaccard)', status: 'idle' },
            ],
            lastResponse: null,
            memorySize: 0,
            toolsLoaded: false,
        };
    }

    private emit(partial: Partial<AgentNodeState>): void {
        this.currentState = { ...this.currentState, ...partial };
        this.onStateChange?.(this.currentState);
    }

    private setPillar(id: PillarState['id'], status: PillarState['status']): void {
        const pillars = this.currentState.pillars.map(p =>
            p.id === id ? { ...p, status } : p
        );
        this.emit({ pillars });
    }

    getState(): AgentNodeState {
        return this.currentState;
    }

    // ─── PIPELINE PRINCIPAL ───────────────────────────────────────────────────

    async process(input: AgentInput, customSystemPrompt?: string): Promise<AgentResponse> {
        this.emit({ status: 'processing', activeIntent: null });

        try {
            // ── Pilar 1: Captura dinámica ─────────────────────────────────────
            this.setPillar('capture', 'processing');
            const userMessage = input.transcription ?? input.text ?? '';
            if (!userMessage.trim()) throw new Error('No hay mensaje de entrada');

            const sessionId = input.sessionId;
            logger.info(`[AgentNode] 📩 Mensaje Recibido: "${userMessage}" | Session: ${sessionId}`);

            if (input.clientPhone) {
                agentMemory.setClient(sessionId, input.clientPhone);
            }
            agentMemory.append(sessionId, 'user', userMessage);
            this.setPillar('capture', 'success');

            // ── Pilar 2: Cargar tools / contexto (genérico, sin comercio) ─────
            this.setPillar('tools', 'processing');
            const memoryData = agentMemory.get(sessionId);
            const toolsCtx: ToolsContext = await loadToolsContext(memoryData.clientPhone);
            logger.info(`[AgentNode] 🛠️  Contexto cargado: ${toolsCtx.products?.length || 0} items`);

            const toolsBlock = formatToolsForPrompt(toolsCtx);
            this.emit({ toolsLoaded: true });
            this.setPillar('tools', 'success');

            // ── Construir prompt completo ──────────────────────────────────────
            const basePrompt = customSystemPrompt || DEFAULT_SYSTEM_PROMPT;
            const historyBlock = agentMemory.formatForPrompt(sessionId);
            const fullSystemPrompt = `${basePrompt}
${INTENT_CONTRACT}
${toolsBlock ? `\n--- INFORMACIÓN ACTUAL ---\n${toolsBlock}\n` : ''}
--- HISTORIAL DE CONVERSACIÓN ---
${historyBlock || '(sin historial previo)'}`;

            // ── Llamar a la IA (Groq → Gemini fallback automático) ────────────
            this.setPillar('json', 'processing');
            const history = agentMemory.toAIServiceFormat(sessionId).slice(0, -1); // sin el último (ya es el mensaje actual)

            logger.info(`[AgentNode] 🧠 Llamando a la IA... (History: ${history.length} msgs)`);
            const rawResponse = await AIService.complete({
                systemPrompt: fullSystemPrompt,
                userMessage,
                history,
                temperature: 0.3,
                maxTokens: 800,
                apiKey: input.apiKey,   // Clave inyectada desde el nodo visual
                model: input.model,     // Modelo inyectado desde el nodo visual
            });

            logger.info(`[AgentNode] 🤖 Respuesta RAW de la IA:\n${rawResponse}`);

            // ── Pilar 3: Parsear JSON robusto (3 intentos) ────────────────────
            const parsed = parseAgentResponse(rawResponse);
            logger.info(`[AgentNode] 📝 JSON Parseado | Intent: ${parsed.intent} | Response: "${parsed.response.substring(0, 50)}..."`);
            this.setPillar('json', parsed.intent === 'FALLBACK' ? 'error' : 'success');

            // ── Pilar 4: Resolver items contra catálogo (vacío en genérico) ───
            this.setPillar('resolver', 'processing');
            const resolvedItems = resolveItems(parsed.items, toolsCtx.products ?? []);
            if (resolvedItems.length > 0) {
                logger.info(`[AgentNode] 📦 Items detectados: ${resolvedItems.map(i => `${i.qty}x ${i.resolvedName || i.name}`).join(', ')}`);
            }
            const finalResponse: AgentResponse = {
                ...parsed,
                items: resolvedItems,
                rawJson: rawResponse,
            };
            this.setPillar('resolver', 'success');

            // ── Guardar respuesta en memoria de la sesión ─────────────────────
            agentMemory.append(sessionId, 'assistant', finalResponse.response, finalResponse.intent as IntentType);

            this.emit({
                status: 'success',
                activeIntent: finalResponse.intent as IntentType,
                lastResponse: finalResponse,
                memorySize: agentMemory.size(sessionId),
            });

            logger.info(`[AgentNode] ✅ Pipeline complete | Intent: ${finalResponse.intent} | Items: ${resolvedItems.length}`);
            return finalResponse;

        } catch (error: any) {
            this.setPillar('capture', 'error');
            this.emit({ status: 'error' });
            logger.error('[AgentNode] Pipeline error:', { error: error.message });

            // SUPERVIVENCIA: Si falló la IA, intentamos rescatar la intención por palabras clave
            const lowerText = input.text?.toLowerCase() || '';
            let rescuedIntent: IntentType = 'FALLBACK';

            if (lowerText.match(/humano|persona|asesor|robot|operador|no quiero hablar/)) rescuedIntent = 'HANDOFF';
            else if (lowerText.match(/hola|buen|saludo|que tal/)) rescuedIntent = 'GREETING';
            else if (lowerText.match(/pedido|quiero|comprar|ordenar/)) rescuedIntent = 'ORDER';

            return {
                ...FALLBACK_RESPONSE,
                intent: rescuedIntent
            };
        }
    }

    /** Mapea el intent en inglés → español para el conditionResult del flujo */
    static mapIntent(intent: IntentType): string {
        return INTENT_MAP[intent] ?? 'desconocido';
    }

    clearSession(sessionId: string): void {
        agentMemory.clear(sessionId);
        this.currentState = this.buildInitialState();
        this.emit(this.currentState);
    }
}

// Singleton para reutilizar entre ejecuciones (mantiene estado de pillars)
export const agentNode = new AgentNode();

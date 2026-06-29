// ─── SupervisorService ────────────────────────────────────────────────────────
// Capa "Agente IA omnipresente". Cuando el usuario, DENTRO de un flujo, responde
// algo que no matchea directo con el paso actual, este supervisor interpreta el
// mensaje en contexto y decide:
//   - 'fill'   → la respuesta SÍ corresponde a una opción esperada, dicha de otra
//                forma (ej "iba manejando y me chocaron" → "conductor"). Devuelve
//                el valor canónico para que el flujo avance.
//   - 'side'   → pregunta/objeción off-topic pero quiere seguir → responde breve y
//                el flujo re-pregunta el paso.
//   - 'switch' → reveló otra necesidad → rutea al flujo correcto (por trigger).
//   - 'human'  → pide persona / frustrado → handoff.
//   - 'none'   → no hay IA configurada; el motor mantiene su comportamiento actual.
//
// Se invoca SOLO cuando el match barato del nodo falla (gating de costo).

import { AIService } from './AIService';
import { SupportAgentService } from './SupportAgentService';
import { logger } from '../utils/logger';
import { resolveOption } from '../core/agent/context/OptionResolver';

export interface SupervisorDecision {
    action: 'fill' | 'side' | 'switch' | 'human' | 'answer' | 'none';
    value?: string;     // opción canónica (action='fill')
    reply?: string;     // respuesta breve al usuario (action='side')
    trigger?: string;   // trigger del flujo destino (action='switch')
    reason?: string;
}

export class SupervisorService {
    static async interpret(params: {
        accountId: string;
        question: string;        // qué pregunta el paso actual
        expectedOptions: string[]; // opciones válidas inferidas del nodo
        userInput: string;
        pushName?: string;
    }): Promise<SupervisorDecision> {
        const { accountId, question, expectedOptions, userInput } = params;
        if (!userInput || !userInput.trim()) return { action: 'none' };

        // Pre-pass determinístico (Capacidad 4): si el usuario se refiere a una opción
        // por orden/posición ("el tercero", "la opción 1"), la resolvemos sin gastar IA.
        if (expectedOptions.length) {
            const offered = expectedOptions.map((o, i) => ({ index: i + 1, label: o, value: o }));
            const picked = resolveOption({ userText: userInput, offered });
            if (picked.matchedValue && picked.confianza >= 0.8) {
                logger.info(`[Supervisor] pre-pass OptionResolver → fill "${picked.matchedValue}"`);
                return { action: 'fill', value: picked.matchedValue };
            }
        }

        const { flows, config } = await SupportAgentService.loadAccountContext(accountId);
        if (!config.apiKey) {
            logger.info('[Supervisor] sin API key → none');
            return { action: 'none' };
        }

        const optionsBlock = expectedOptions.length
            ? expectedOptions.map((o, i) => `${i + 1}. ${o}`).join('\n')
            : '(este paso acepta texto libre, no hay opciones cerradas)';

        const flowsBlock = flows.length
            ? flows.map(f => `- trigger="${f.trigger}" — ${f.name}`).join('\n')
            : '(sin otros flujos)';

        const ctx = (config.businessContext || '').trim();

        const systemPrompt = `${config.prompt || 'Sos un asistente de soporte conversacional.'}

Estás supervisando una conversación que está EN un flujo de atención. El paso actual le pregunta al usuario:
"${question}"

OPCIONES VÁLIDAS para este paso:
${optionsBlock}

Otros flujos de atención disponibles (por si el usuario en realidad quiere otra cosa):
${flowsBlock}

DATOS DEL ESTUDIO (única fuente para responder preguntas generales):
${ctx || '(no hay datos cargados)'}

El usuario respondió: "${userInput}"

Interpretá la intención real y respondé ÚNICAMENTE con JSON válido, sin texto extra:
{ "action": "fill" | "side" | "switch" | "human" | "answer", "value": "<opción exacta o null>", "reply": "<texto o null>", "trigger": "<trigger o null>" }

REGLAS:
- "fill": si la respuesta CORRESPONDE a una de las opciones válidas, aunque esté dicha de otra forma (ej "iba manejando y me chocaron" → la opción "Conductor"). En "value" poné el texto EXACTO de la opción elegida (tal cual aparece en la lista).
- "side": si hace una pregunta u objeción off-topic pero igual quiere continuar. En "reply" poné una respuesta breve y amable; luego el sistema repetirá la pregunta del paso.
- "switch": si su intención encaja claramente con OTRO flujo. En "trigger" poné el trigger exacto de ese flujo.
- "human": si pide hablar con una persona o está claramente molesto/frustrado.
- "answer": si hace una pregunta general respondible con los DATOS DEL ESTUDIO. En "reply" la respuesta en rol (humana, breve, voseo, máx 1 emoji). Si el dato NO está arriba, NO uses answer: usá "human".
- Ante la duda razonable de que SÍ es una respuesta al paso, preferí "fill".`;

        let parsed: any = null;
        try {
            parsed = await AIService.extractJSON({
                systemPrompt,
                userMessage: userInput,
                jsonMode: true,
                temperature: 0.1,
                maxTokens: 220,
                apiKey: config.apiKey,
                model: config.model,
            });
        } catch (err: any) {
            logger.warn('[Supervisor] fallo IA', { error: err.message });
            return { action: 'none' };
        }
        if (!parsed || !parsed.action) return { action: 'none' };

        switch (parsed.action) {
            case 'fill': {
                // Validar que el value corresponda a una opción real (anti-alucinación).
                const want = String(parsed.value || '').trim().toLowerCase();
                const match = expectedOptions.find(o => o.toLowerCase().trim() === want);
                if (!match) {
                    logger.info(`[Supervisor] fill con value inválido "${parsed.value}" → side`);
                    return { action: 'side', reply: parsed.reply || undefined, reason: 'value no matchea opciones' };
                }
                logger.info(`[Supervisor] fill → "${match}"`);
                return { action: 'fill', value: match };
            }
            case 'switch': {
                const want = String(parsed.trigger || '').trim().toLowerCase();
                const match = flows.find(f => f.trigger.toLowerCase() === want);
                if (!match) return { action: 'human', reason: 'trigger inválido' };
                logger.info(`[Supervisor] switch → "${match.trigger}"`);
                return { action: 'switch', trigger: match.trigger };
            }
            case 'human':
                return { action: 'human' };
            case 'answer': {
                const reply = String(parsed.reply || '').trim();
                if (!ctx || !reply) return { action: 'human', reason: 'answer sin contexto/reply' };
                return { action: 'answer', reply };
            }
            case 'side':
            default:
                return { action: 'side', reply: parsed.reply || undefined };
        }
    }
}

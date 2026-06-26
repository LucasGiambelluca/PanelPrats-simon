import { supabase } from '../../config/database';
import { FlowDefinition, FlowExecution } from '../../flows/types/flow.types';
import { ShortcutsManager } from '../../services/ShortcutsManager';
import { logger } from '../../utils/logger';
import { validateNode } from './node.validator';
import { sessionAuditor } from './session.auditor';
import { SessionQueue } from './session.queue';
import { SessionRepository } from '../../infrastructure/repositories/SessionRepository';
import { nodeExecutorFactory } from '../executors/NodeExecutorFactory';
import { Session } from '../domain/Session';
import { redisPersistence } from '../../infrastructure/persistence/RedisPersistenceService';
import { PhoneUtils } from '../../utils/phoneUtils';
import { ConfigurationService } from '../../services/ConfigurationService';
import { SupervisorService, SupervisorDecision } from '../../services/SupervisorService';
import { memoryAccounts, memoryFlows } from '../accounts/memoryStore';
import { evaluate } from './ConversationGate';

const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_KEY &&
  !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
  !process.env.SUPABASE_SERVICE_KEY.includes('...')
);

export class FlowEngine {
    private db: any;
    private sessionQueues = new Map<string, SessionQueue>();
    private sessionRepository: SessionRepository;
    public orderService: any;
    public slotService: any;

    // In-memory caches for performance.
    // Keyed by `${accountId}:${flowId}` and `${accountId}` so distinct accounts
    // never share cached flow definitions/lists.
    private static flowCache = new Map<string, { definition: FlowDefinition, timestamp: number }>();
    private static flowListCache = new Map<string, { data: any[], timestamp: number }>();
    private static CACHE_TTL = 120000; // 2 minutes

    /**
     * Invalida los caches de flujos. Llamar tras crear/editar/borrar un flujo
     * (desde flows.routes) para que los cambios se reflejen sin esperar el TTL.
     * Sin accountId → flush total (las mutaciones por id no siempre traen accountId).
     */
    public static invalidateFlowCache(accountId?: string): void {
        if (!accountId) {
            FlowEngine.flowCache.clear();
            FlowEngine.flowListCache.clear();
            return;
        }
        FlowEngine.flowListCache.delete(accountId);
        for (const key of FlowEngine.flowCache.keys()) {
            if (key.startsWith(`${accountId}:`)) FlowEngine.flowCache.delete(key);
        }
    }

    constructor(dbClient?: any, orderServiceInstance?: any, slotServiceInstance?: any) {
        this.db = dbClient || supabase;
        this.orderService = orderServiceInstance;
        this.slotService = slotServiceInstance;
        this.sessionRepository = new SessionRepository();
    }

    /**
     * Reseteo público delgado: limpia la sesión activa y el checkpoint de Redis.
     */
    async forceReset(accountId: string, phone: string): Promise<void> {
        await this.sessionRepository.forceReset(accountId, phone);
        await redisPersistence.deleteCheckpoint(accountId, phone);
    }

    /**
     * Entry point for messages. Routes to the appropriate session queue.
     */
    async processMessage(accountId: string, phone: string, messageText: string, context: any = {}, options: { flowId?: string, startNodeId?: string, initialState?: { session: Session | null, conversation: any } } = {}): Promise<any> {
        const remoteJid = context.remoteJid || PhoneUtils.toJid(phone);
        const cleanPhone = PhoneUtils.normalize(phone);
        const sessionId = remoteJid.endsWith('@g.us') ? `group:${remoteJid}` : `1to1:${cleanPhone}`;

        // Namespace the queue per account so distinct accounts never share a FIFO slot.
        const queueKey = `${accountId}:${sessionId}`;
        let queue = this.sessionQueues.get(queueKey);
        if (!queue) {
            queue = new SessionQueue(queueKey, (msg) => this.executeMessage(accountId, phone, msg.text, msg.context, msg.options));
            this.sessionQueues.set(queueKey, queue);
        }

        const result = await queue.enqueue({ phone, text: messageText, context, options });
        // Evict idle queue to prevent unbounded map growth (one entry per phone forever).
        // Safe to check now: enqueue resolves only after THIS job's processor settles and
        // the FIFO slot is released; if another message for this session is queued,
        // queueLength > 0 and we correctly skip eviction.
        const status = queue.getStatus();
        if (status.queueLength === 0 && !status.processing) {
            this.sessionQueues.delete(queueKey);
        }
        return result;
    }

    /**
     * Internal execution logic, called sequentially by the queue.
     */
    private async executeMessage(accountId: string, phone: string, messageText: string, context: any = {}, options: { flowId?: string, startNodeId?: string, initialState?: { session: Session | null, conversation: any } } = {}): Promise<any> {
        const startTime = Date.now();
        const cleanPhone = PhoneUtils.normalize(phone);
        const remoteJid = context.remoteJid || PhoneUtils.toJid(phone);
        const sessionId = remoteJid.endsWith('@g.us') ? `group:${remoteJid}` : `1to1:${cleanPhone}`;

        logger.info(`[FlowEngine] Processing message in queue`, { sessionId, text: messageText.substring(0, 50) });

        const normalizedMsg = this.normalizeInput(messageText);

        // --- GLOBAL SHORTCUTS INTERCEPTOR ---
        const shortcutMessages = await ShortcutsManager.handle(messageText, phone) || await ShortcutsManager.handle(normalizedMsg, phone);
        if (shortcutMessages) {
            logger.info(`[FlowEngine] GLOBAL Shortcut handled: ${normalizedMsg}. Sending priority response.`);
            return { currentStateDefinition: { message_template: shortcutMessages.join('\n') }, messages: shortcutMessages };
        }

        // 1. RUN INITIAL CHECKS IN PARALLEL (only if not pre-fetched)
        const isMemoryAccount = memoryAccounts.has(accountId);
        const flowIdFromAccount = isMemoryAccount ? memoryAccounts.get(accountId)?.flow_id || null : null;

        const [fetchedSession, handoverStatus, matchedFlowResult, accountData] = await Promise.all([
            this.sessionRepository.findActiveSession(accountId, sessionId),
            (isSupabaseConfigured && !isMemoryAccount)
                // Promise.resolve adopta el thenable de PostgrestBuilder => Promise real con .catch
                ? Promise.resolve(this.db.from('whatsapp_conversations').select('status').eq('account_id', accountId).eq('phone', cleanPhone).maybeSingle()).catch(() => ({ data: { status: 'BOT' } }))
                : Promise.resolve({ data: { status: 'BOT' } }),
            this.findFlowByTrigger(accountId, normalizedMsg),
            (isSupabaseConfigured && !isMemoryAccount)
                ? Promise.resolve(this.db.from('accounts').select('flow_id').eq('id', accountId).maybeSingle()).catch(() => ({ data: null }))
                : Promise.resolve({ data: { flow_id: flowIdFromAccount } })
        ]);

        let session: Session | null = fetchedSession;
        const conversation = handoverStatus ? handoverStatus.data : null;
        const { flow: matchedFlow, isWildcard } = matchedFlowResult;

        let isGlobalTrigger = !!matchedFlow;

        // --- WILDCARD PROTECTION ---
        // If it's a wildcard match (*) but we have an active session waiting for input,
        // we IGNORE the global trigger to prevent resetting the flow.
        // Sesión activa esperando input: NO dejar que el trigger (parcial/exacto/wildcard)
        // de OTRO flujo secuestre la conversación. El mensaje va al nodo actual; si está
        // off-track, el Supervisor IA lo interpreta/rerutea. Los breakers (hola/menu/
        // cancelar/reset) ya se interceptaron antes (ShortcutsManager / router).
        if (isGlobalTrigger && session && session.status === 'waiting_input') {
            logger.info(`[FlowEngine] Trigger "${normalizedMsg}" matched pero la sesión espera input en ${session.currentNodeId}. Ignorando (lo maneja el nodo/Supervisor).`);
            isGlobalTrigger = false;
        }

        // INTERCEPCIÓN PRE-MENÚ: si el único match es un flujo wildcard (catch-all)
        // y es una entrada fresca NO forzada, no corremos el menú todavía. Devolvemos
        // una señal para que el router le dé primero la oportunidad al Agente IA de
        // soporte de rutear directo al flujo correcto. Si no puede, el router reingresa
        // con options.flowId = este wildcard para correr el menú como fallback.
        if (isGlobalTrigger && isWildcard && !options.flowId) {
            logger.info(`[FlowEngine] Wildcard "${normalizedMsg}" → difiriendo al Agente IA de soporte (router).`);
            return { currentStateDefinition: { message_template: null, _wildcard_pending: true, _wildcardFlowId: matchedFlow!.id } };
        }

        if (isGlobalTrigger) {
            logger.info(`[FlowEngine] Global trigger detected: "${normalizedMsg}" matches flow ${matchedFlow!.id} (Wildcard: ${isWildcard})`);
            await this.sessionRepository.forceReset(accountId, cleanPhone);

            // Clear handover status if present to resume bot control
            if (conversation?.status === 'HANDOVER') {
                await this.db.from('whatsapp_conversations')
                    .update({ status: 'BOT', updated_at: new Date().toISOString() })
                    .eq('account_id', accountId)
                    .eq('phone', cleanPhone);
            }
            session = null; // Forces recalculation of flow
        }

        // Check handover AFTER trigger check (Reset allows breaking handover)
        if (conversation?.status === 'HANDOVER' && !isGlobalTrigger) {
            logger.info(`[FlowEngine] Session in HANDOVER Mode for ${phone}. Skipping bot processing.`);
            return null;
        }

        try {
            const cleanMessage = messageText.trim().toLowerCase();
            // cleanPhone and sessionId are already calculated correctly above
            // Use them consistently below

            const accumulatedMessages: any[] = [];
            const previousNodeId = session?.currentNodeId || null;

            // If no session exists, we must resolve the flow
            if (!session) {
                let flowId = options.flowId;
                let flow = null;

                if (flowId) {
                    flow = await this.getFlowDefinition(accountId, flowId);
                } else if (isGlobalTrigger) {
                    flow = matchedFlow;
                } else if (accountData?.data?.flow_id) {
                    flow = await this.getFlowDefinition(accountId, accountData.data.flow_id);
                }

                if (!flow) {
                    // --- WEBHOOK HOOK FALLBACK (Phase 5) ---
                    // Using cached flow list to avoid expensive DB scan
                    const { data: webhookFlows } = await this.getAllActiveFlows(accountId);

                    const hookFlow = webhookFlows?.find((f: any) =>
                        f.nodes?.some((n: any) => n.type === 'webhookNode')
                    );

                    if (hookFlow) {
                        logger.info(`[FlowEngine] No trigger match, but found Webhook flow: "${hookFlow.name}". Starting it.`);
                        flow = hookFlow;
                    } else {
                        // No trigger match and no webhook flow → delegate back to Router for AI-powered Smart Start
                        logger.info(`[FlowEngine] No flow matched trigger "${messageText.substring(0, 40)}" and no Webhook flow found. Delegating to AI.`);
                        return { currentStateDefinition: { message_template: null, _no_flow_match: true } };
                    }
                }

                flowId = flow.id;
                await this.sessionRepository.forceReset(accountId, cleanPhone);

                // --- DYNAMIC START NODE (Webhook priority) ---
                const fullFlow = await this.getFlowDefinition(accountId, flowId!);
                const webhookNode = fullFlow?.nodes?.find((n: any) => n.type === 'webhookNode');
                const effectiveStartNodeId = options.startNodeId || webhookNode?.id || 'start';

                session = await this.sessionRepository.getOrCreate(accountId, sessionId, phone, flowId!, {
                    variables: {
                        shared: {},
                        global: {
                            ...context,
                            accountId,
                            pushName: context.pushName || 'Cliente',
                            phoneNumber: phone,
                            chatJid: remoteJid,
                            phone: phone,
                            startedAt: new Date().toISOString(),
                            user_message: messageText,
                            _is_audio: context?._isAudio || false
                        }
                    },
                    metadata: { flowId: flowId!, flowVersion: 1, entryPoint: flowId === options.flowId ? 'manual' : 'trigger' }
                }, effectiveStartNodeId);

                // Memoria de conversación: 30 días. Si el contacto deja de contestar y
                // vuelve dentro de los 30 días, la sesión sigue (no reinicia). Se refresca
                // en cada mensaje (ver persistencia); pasados 30 días sin actividad, expira.
                const expirationDate = new Date();
                expirationDate.setDate(expirationDate.getDate() + 30);
                session.getContext().metadata.expiresAt = expirationDate;

                if (!(options.startNodeId && options.startNodeId !== 'start')) {
                    const nodes = fullFlow?.nodes || [];
                    const startNode = nodes.find((n: any) => n.id === session!.currentNodeId);
                    if (!(startNode && ['intentResolverNode', 'genderNode', 'groqNode', 'questionNode', 'webhookNode'].includes(startNode.type))) {
                        await this.handleInput(accountId, session, this.normalizeInput(messageText));
                    }
                }
            }

            if (!session) throw new Error('Session initialization failed');

            if (session.status === 'waiting_input') {
                await this.handleInput(accountId, session, normalizedMsg);

                // IF INTELLIGENT ESCAPE TRIGGERED: Abort this chain
                if ((session as any)._exitToAI) {
                    logger.info(`[FlowEngine] [EXIT_AI] Signal received. Terminating flow to allow Global AI routing.`);
                    return { currentStateDefinition: { message_template: null, _restart_ai: true, _aiResult: (session as any)._aiResult } };
                }

                if ((session as any)._pendingMessages) {
                    accumulatedMessages.push(...(session as any)._pendingMessages);
                    delete (session as any)._pendingMessages;
                }

                // Persist the input-driven advance BEFORE running side-effecting executors,
                // so a chain failure cannot lose the user's progress.
                await this.sessionRepository.update(accountId, session);
            }

            // 2. Execute Node Chain (Only if moved or now active)
            if (session.currentNodeId !== previousNodeId || session.status === 'active') {
                const chainMessages = await this.executeNodeChain(accountId, session);
                accumulatedMessages.push(...chainMessages);
            }

            // Persistencia best-effort: si falla (p.ej. columna faltante / hiccup de DB),
            // logueamos pero NO descartamos los mensajes ya generados. Reemplazar una
            // respuesta válida por "Ocurrió un error" es peor que perder el checkpoint.
            try {
                // Refrescar la ventana de memoria a 30 días desde la última actividad.
                const refreshed = new Date();
                refreshed.setDate(refreshed.getDate() + 30);
                session.getContext().metadata.expiresAt = refreshed;
                await this.sessionRepository.update(accountId, session);
                await redisPersistence.setCheckpoint(accountId, cleanPhone, {
                    currentNodeId: session.currentNodeId,
                    status: session.status,
                    variables: session.getAllVariablesForCurrentFlow(),
                    flowId: session.getContext().metadata.flowId
                });
            } catch (persistErr: any) {
                logger.error(`[FlowEngine] Persistencia de sesión falló (respuesta igual se envía)`, { error: persistErr?.message });
            }

            return { currentStateDefinition: { message_template: accumulatedMessages } };

        } catch (err: any) {
            logger.error(`[FlowEngine] Critical error`, { error: err.message });
            try { if (session) await this.sessionRepository.update(accountId, session); } catch (_) { /* best-effort */ }
            return { currentStateDefinition: { message_template: '⚠️ Ocurrió un error. Reintentá en un momento.' } };
        }
    }

    // ─── Agente IA omnipresente (Supervisor) ──────────────────────────────────
    // Infiere las opciones esperadas del paso actual "auto desde el nodo":
    //  - pollNode → sus opciones.
    //  - questionNode/otro → si el/los nodo(s) siguiente(s) ramifican sobre la
    //    MISMA variable (switchNode.cases / conditionNode.expectedValue), usa esos
    //    valores. Si no ramifica → texto libre (sin opciones, no se supervisa).
    private gatherExpectedOptions(flow: FlowDefinition, node: any): string[] {
        const stripPrefix = (s: string) => String(s).replace(/^\d+[\s.)-]*\s*/, '').trim();
        if (node.type === 'pollNode') {
            return (node.data?.options || []).map(stripPrefix).filter(Boolean);
        }
        const variable = (node.data?.variable || '').trim();
        if (!variable) return [];
        const edges = flow.edges || [];
        const nodes = flow.nodes || [];
        const out: string[] = [];
        const visited = new Set<string>();
        let frontier = edges.filter((e: any) => e.source === node.id)
            .map((e: any) => nodes.find((n: any) => n.id === e.target))
            .filter(Boolean);
        let hops = 0;
        while (frontier.length && hops < 8) {
            const next: any[] = [];
            for (const nx of frontier) {
                if (!nx || visited.has(nx.id)) continue;
                visited.add(nx.id);
                const nxVar = (nx.data?.variable || '').trim();
                if (nx.type === 'switchNode' && nxVar === variable) {
                    for (const c of (nx.data?.cases || [])) if (c?.value) out.push(String(c.value));
                } else if (nx.type === 'conditionNode' && nxVar === variable) {
                    // Solo condiciones de igualdad representan opciones discretas;
                    // las numéricas (greater_than/less_than) NO son enumerables.
                    const op = nx.data?.operator || 'equals';
                    if (nx.data?.expectedValue && (op === 'equals' || op === 'not_equals')) {
                        out.push(String(nx.data.expectedValue));
                    }
                    // Seguir la rama 'false' para juntar la cadena de condiciones.
                    for (const e of edges.filter((e: any) => e.source === nx.id && String(e.sourceHandle).toLowerCase() === 'false')) {
                        const t = nodes.find((n: any) => n.id === e.target);
                        if (t) next.push(t);
                    }
                }
                // Nodos que no son switch/condition cortan el rastreo.
            }
            frontier = next;
            hops++;
        }
        return [...new Set(out.map(o => o.trim()).filter(Boolean))];
    }

    // ¿El paso alimenta una condición numérica sobre su variable, o esa variable se
    // usa en una expresión {{var}} de una condición aguas abajo? → se trata como número.
    private stepExpectsNumber(flow: FlowDefinition, node: any): boolean {
        const variable = (node.data?.variable || '').trim();
        if (!variable) return false;
        const edges = flow.edges || [];
        const nodes = flow.nodes || [];
        const refRe = new RegExp(`\\{\\{\\s*${variable}\\s*\\}\\}`);
        const visited = new Set<string>([node.id]);
        let frontier: string[] = edges.filter((e: any) => e.source === node.id).map((e: any) => e.target);
        let hops = 0;
        while (frontier.length && hops < 6) {
            const next: string[] = [];
            for (const id of frontier) {
                if (visited.has(id)) continue;
                visited.add(id);
                const nx = nodes.find((n: any) => n.id === id);
                if (!nx) continue;
                if (nx.type === 'conditionNode') {
                    const op = nx.data?.operator;
                    const ev = String(nx.data?.expectedValue || '');
                    const sameVarNumeric = (nx.data?.variable || '').trim() === variable && (op === 'greater_than' || op === 'less_than');
                    if (sameVarNumeric || refRe.test(ev)) return true;
                }
                for (const e of edges.filter((e: any) => e.source === id)) next.push(e.target);
            }
            frontier = next;
            hops++;
        }
        return false;
    }

    // Aplica el veredicto del supervisor que NO es 'fill'. Devuelve true si el caller
    // debe cortar (quedarse en el paso o escapar al router); false si debe continuar.
    private applySupervisorOutcome(session: Session, decision: SupervisorDecision, repromptMsg: string): boolean {
        if (decision.action === 'fill') return false;
        session.status = 'waiting_input';
        if (decision.action === 'side') {
            const txt = decision.reply ? `${decision.reply}\n\n${repromptMsg}` : repromptMsg;
            (session as any)._pendingMessages = [txt];
            return true;
        }
        if (decision.action === 'answer') {
            const txt = decision.reply ? `${decision.reply}\n\n${repromptMsg}` : repromptMsg;
            (session as any)._pendingMessages = [txt];
            return true;
        }
        // switch / human / none → escapar al router (Agente IA de soporte).
        (session as any)._exitToAI = true;
        (session as any)._aiResult = {
            route: decision.action === 'switch' ? decision.trigger : undefined,
            handoff: decision.action === 'human',
            fallbackMessage: [repromptMsg],
        };
        return true;
    }

    private async handleInput(accountId: string, session: Session, input: string): Promise<void> {
        console.log(`\x1b[41m [FLOW-TRACE] handleInput START | Node: ${session.currentNodeId} | Input: "${input}" | SessionStatus: ${session.status} \x1b[0m`);
        session.status = 'active'; // Mark as active now that we got input
        const flowId = session.getContext().metadata.flowId;
        const flow = await this.getFlowDefinition(accountId, flowId);
        if (!flow) {
            logger.error(`[FlowEngine] [handleInput] Flow not found: ${flowId}`);
            return;
        }

        const currentNode = (flow.nodes || []).find((n: any) => n.id === session.currentNodeId);
        if (!currentNode) return;

        // Nodo de saludo abierto: la respuesta libre se rutea por IA (answer/route/handoff).
        if (currentNode.data?.route_by_ai) {
            const { SupportAgentService } = await import('../../services/SupportAgentService');
            const decision = await SupportAgentService.resolve({
                accountId, text: input, pushName: session.getVariable('pushName'),
            });
            if (decision.action === 'route' && decision.trigger) {
                (session as any)._exitToAI = true;
                (session as any)._aiResult = { route: decision.trigger };
                session.logInteraction(session.currentNodeId, input);
                return;
            }
            if (decision.action === 'answer' && decision.reply) {
                (session as any)._pendingMessages = [decision.reply];
                // tras responder, avanzar al siguiente nodo (botones de respaldo)
            } else if (decision.action === 'handoff') {
                (session as any)._exitToAI = true;
                (session as any)._aiResult = { handoff: true };
                session.logInteraction(session.currentNodeId, input);
                return;
            }
            // answer o none → caer al avance normal (muestra el poll de botones)
            session.setVariable(currentNode.data?.variable || 'consulta', input);
            session.logInteraction(session.currentNodeId, input);
            const nextId = this.findNextNodeId(flow, currentNode.id, undefined);
            if (nextId) { session.currentNodeId = nextId; } else { session.status = 'waiting_input'; }
            return;
        }

        let processedInput = input;
        const varName = (currentNode.data?.variable || 'user_choice').trim();

        // 1. Specialized input handling via Executor
        const executor = nodeExecutorFactory.getExecutor(currentNode.type);
        console.log(`\x1b[43m [FLOW-TRACE] Executor: ${currentNode.type} | hasHandleInput: ${!!executor.handleInput} | Input: "${input}" \x1b[0m`);
        if (executor.handleInput) {
            const handleInputContext = { ...session.getAllVariablesForCurrentFlow(), phone: session.userPhone, accountId };
            const result = await executor.handleInput(input, currentNode.data, handleInputContext as any);
            console.log(`\x1b[43m [FLOW-TRACE] executor.handleInput result: isValid=${result.isValidInput}, updatedKeys=${result.updatedContext ? Object.keys(result.updatedContext) : 'none'}, msgs=${result.messages?.length || 0} \x1b[0m`);

            // Apply context updates from executor
            if (result.updatedContext) {
                Object.entries(result.updatedContext).forEach(([k, v]) => {
                    session.setVariable(k, v);
                    // Mirror al namespace compartido (igual que las respuestas de preguntas):
                    // así {{nombre}}/{{genero}} sobreviven un cambio de flujo (flowLink).
                    if (k && !k.startsWith('_')) session.setGlobalVariable(k, v);
                });
            }

            // If the executor returned immediate messages (like Stock results), add them to session logs
            // or we might need to handle how they are sent.
            // For now, let's assume session variables are the source of truth for the NEXT node.
            if (result.messages && result.messages.length > 0) {
                (session as any)._pendingMessages = result.messages;
            }
            if (result.isValidInput === false) {
                session.status = 'waiting_input';
                session.logInteraction(session.currentNodeId, input);
                return; // Exit handleInput early to keep waiting_input
            }
        } else {
            // Default behavior: just store the raw input
            // Poll handling (Legacy/Hardcoded): resolve numeric input to option text
            if (currentNode.type === 'pollNode') {
                const options = currentNode.data?.options || ['Sí', 'No'];
                const numericMatch = input.replace(/[\*_]/g, '').match(/\d+/);
                let index = numericMatch ? parseInt(numericMatch[0]) - 1 : -1;

                if (index < 0 || index >= options.length) {
                    const stripped = options.map((o: string) => o.replace(/^\d+[\s.)-]*\s*/, '').trim());
                    const retryKey = `_gate_retries_${currentNode.id}`;
                    const retryCount = parseInt(session.getVariable(retryKey) || '0', 10);
                    const gate = evaluate({
                        input,
                        expectedOptions: stripped,
                        retryCount,
                        maxRetries: parseInt(currentNode.data?.max_retries ?? '0', 10),
                        synonyms: currentNode.data?.synonyms,
                    });

                    const question = currentNode.data?.question || 'Elegí una opción:';
                    const repromptMsg = `Disculpá, no te seguí 🙈 ¿me lo decís de nuevo?\n\n${question}`;

                    if (gate.decision === 'match') {
                        index = stripped.findIndex((o: string) => o === gate.value);
                        session.setVariable(retryKey, '0');
                    } else if (gate.decision === 'reprompt') {
                        session.setVariable(retryKey, (retryCount + 1).toString());
                        (session as any)._pendingMessages = [repromptMsg];
                        session.status = 'waiting_input';
                        session.logInteraction(session.currentNodeId, input);
                        return;
                    } else {
                        // escalate → Supervisor IA (puede answer/fill/switch/human)
                        session.setVariable(retryKey, '0');
                        const decision = await SupervisorService.interpret({
                            accountId, question, expectedOptions: stripped,
                            userInput: input, pushName: session.getVariable('pushName'),
                        });
                        if (decision.action === 'fill' && decision.value) {
                            index = stripped.findIndex((o: string) => o === decision.value);
                        } else {
                            this.applySupervisorOutcome(session, decision, repromptMsg);
                            session.logInteraction(session.currentNodeId, input);
                            return;
                        }
                    }
                } else {
                    // index ya válido por número → match directo, limpiar reintentos
                    session.setVariable(`_gate_retries_${currentNode.id}`, '0');
                }

                if (index >= 0 && index < options.length) {
                    processedInput = options[index];
                    session.setVariable(`${varName}_index`, (index + 1).toString());
                    session.setVariable(`_poll_selected_handle_${currentNode.id}`, `option-${index}`);
                    logger.info(`[FlowEngine] [INPUT] Resolved poll input "${input}" to "${processedInput}"`);
                }
            } else if (this.stepExpectsNumber(flow, currentNode)) {
                // El paso espera un número (edad, años, etc.) → extraerlo aunque venga
                // con palabras ("tengo 67 años" → "67"). Si no hay número, se deja crudo.
                const m = input.match(/\d{1,4}/);
                if (m) {
                    processedInput = m[0];
                    logger.info(`[FlowEngine] [INPUT] Número extraído de "${input}" → "${processedInput}"`);
                }
            } else {
                // questionNode / genérico: el gate decide si reprompt (barato) o escala a IA.
                const expected = this.gatherExpectedOptions(flow, currentNode);
                if (expected.length > 0) {
                    const retryKey = `_gate_retries_${currentNode.id}`;
                    const retryCount = parseInt(session.getVariable(retryKey) || '0', 10);
                    const gate = evaluate({
                        input, expectedOptions: expected, retryCount,
                        maxRetries: parseInt(currentNode.data?.max_retries ?? '0', 10),
                        synonyms: currentNode.data?.synonyms,
                    });
                    const question = currentNode.data?.question || currentNode.data?.label || 'el paso anterior';
                    const repromptMsg = `Disculpá, no te seguí 🙈 ¿me lo repetís?`;

                    if (gate.decision === 'match') {
                        processedInput = gate.value;
                        session.setVariable(retryKey, '0');
                    } else if (gate.decision === 'reprompt') {
                        session.setVariable(retryKey, (retryCount + 1).toString());
                        (session as any)._pendingMessages = [repromptMsg];
                        session.status = 'waiting_input';
                        session.logInteraction(session.currentNodeId, input);
                        return;
                    } else {
                        session.setVariable(retryKey, '0');
                        const decision = await SupervisorService.interpret({
                            accountId, question: String(question), expectedOptions: expected,
                            userInput: input, pushName: session.getVariable('pushName'),
                        });
                        if (decision.action === 'fill' && decision.value) {
                            processedInput = decision.value;
                        } else {
                            this.applySupervisorOutcome(session, decision, String(question));
                            session.logInteraction(session.currentNodeId, input);
                            return;
                        }
                    }
                }
            }
            session.setVariable(varName, processedInput);
            session.setVariable(`${varName}_raw`, input);
            // Mirror al namespace compartido: las variables se scopean por flowId, así que
            // sin esto un cambio de flujo (flowLink a "Agendar Cita", etc.) "perdía" datos
            // como {{nombre}}. Solo variables reales, no las internas (_gate_retries, etc.).
            if (varName && !varName.startsWith('_')) {
                session.setGlobalVariable(varName, processedInput);
            }
        }

        session.logInteraction(session.currentNodeId, input);

        // 2. Advance to next node (Universal advancement for nodes that wait for input)
        // For intentResolverNodes, use the classified intent as edge handle for routing
        let advanceHandle: string | undefined;
        if (currentNode.type === 'intentResolverNode') {
            const outputVar = currentNode.data?.output_variable || 'intent_clasificado';
            advanceHandle = session.getVariable(outputVar);
            logger.info(`[FlowEngine] [INPUT] IntentResolver classified intent: "${advanceHandle}" (var: ${outputVar})`);
        } else if (currentNode.type === 'genderNode') {
            // El género clasificado ('hombre'|'mujer'|'desconocido') es el handle de salida.
            const outputVar = currentNode.data?.outputVariable || currentNode.data?.output_variable || 'genero';
            advanceHandle = session.getVariable(outputVar);
            logger.info(`[FlowEngine] [INPUT] Gender clasificado: "${advanceHandle}" (var: ${outputVar})`);
        } else if (currentNode.type === 'orderValidatorNode') {
            advanceHandle = session.getVariable('order_validation_result');
            logger.info(`[FlowEngine] [INPUT] OrderValidator selected: "${advanceHandle}"`);
        } else if (currentNode.type === 'pollNode') {
            // Use the handle stored during input processing
            advanceHandle = session.getVariable(`_poll_selected_handle_${currentNode.id}`);
            logger.info(`[FlowEngine] [INPUT] Poll selected handle: "${advanceHandle}"`);
        } else if (currentNode.type === 'locationValidatorNode') {
            advanceHandle = session.getVariable('location_validation_result');
            logger.info(`[FlowEngine] [INPUT] LocationValidator result: "${advanceHandle}"`);
        }

        const nextNodeId = this.findNextNodeId(flow, currentNode.id, advanceHandle);
        console.log(`\x1b[36m[DEBUG-FLOW] NodeType: ${currentNode.type} | Handle: "${advanceHandle}" | Next Node: "${nextNodeId}" | Available edges from ${currentNode.id}: ${(flow.edges || []).filter((e: any) => e.source === currentNode.id).map((e: any) => `${e.sourceHandle || 'default'}->${e.target}`).join(', ')}\x1b[0m`);
        if (nextNodeId) {
            session.currentNodeId = nextNodeId;
            logger.info(`[FlowEngine] [INPUT] Advancing session from ${currentNode.id} to ${nextNodeId} (Type: ${currentNode.type}, Handle: ${advanceHandle || 'default'})`);
        } else {
            logger.error(`[FlowEngine] [INPUT] ⚠️ STALL DETECTED: No next node found for ${currentNode.id} (${currentNode.type}) with handle "${advanceHandle}". Reverting to waiting_input.`);
            // CRITICAL FIX: Revert to waiting_input so executeNodeChain doesn't
            // re-execute the same node (which would resend the prompt in a loop)
            session.status = 'waiting_input';
        }
    }

    private async executeNodeChain(accountId: string, session: Session): Promise<string[]> {
        let accumulatedMessages: string[] = (session as any)._pendingMessages || [];
        (session as any)._pendingMessages = []; // Clear after moving to accumulator

        let iterations = 0;
        const MAX_ITERATIONS = 50;

        while (iterations < MAX_ITERATIONS) {
            iterations++;

            const flowId = session.getContext().metadata.flowId;
            const flow = await this.getFlowDefinition(accountId, flowId);
            if (!flow) {
                logger.error(`[FlowEngine] Flow definition not found for session ${session.id}`, { flowId });
                await this.sessionRepository.forceReset(accountId, session.userPhone);
                accumulatedMessages.push('⚠️ Tu sesión anterior expiró o el menú cambió. Por favor, escribí "hola" para empezar de nuevo.');
                break;
            }

            const currentNode = (flow.nodes || []).find((n: any) => n.id === session.currentNodeId);
            if (!currentNode) {
                logger.warn(`[FlowEngine] [RECOVERY] Node "${session.currentNodeId}" not found in flow "${flow.name}". Resetting to start node.`);
                const startNode = (flow.nodes || []).find((n: any) =>
                    n.type === 'start' ||
                    (n.data && n.data.type === 'start') ||
                    n.id === 'start'
                );
                if (startNode) {
                    session.currentNodeId = startNode.id;
                    continue; // Re-evaluate with the new start node
                }
                logger.error(`[FlowEngine] [CRITICAL] No start node found in flow "${flow.name}". Aborting.`);
                break;
            }

            logger.info(`[FlowEngine] [TRAVERSE] Node: ${currentNode.id} (${currentNode.type})`);

            // Audit Start
            logger.debug(`[FlowEngine] Executing node ${currentNode.id} (${currentNode.type})`);
            sessionAuditor.log({
                session_id: session.id,
                user_phone: session.userPhone,
                event_type: 'node_execution',
                details: { status: 'started', node_id: currentNode.id, node_type: currentNode.type }
            });

            // 2.3. Execute
            const executor = nodeExecutorFactory.getExecutor(currentNode.type);
            const context = { ...session.getAllVariablesForCurrentFlow(), phone: session.userPhone, accountId };

            const stepStartTime = Date.now();
            const result = await executor.execute(currentNode.data, context as any, this);
            const stepDuration = Date.now() - stepStartTime;

            // Apply context updates from executor (Crucial for state persistence)
            if (result.updatedContext) {
                Object.entries(result.updatedContext).forEach(([k, v]) => {
                    session.setVariable(k, v);
                    // Mirror al namespace compartido para que sobreviva saltos de flujo.
                    if (k && !k.startsWith('_') && k !== 'last_ai_completed') session.setGlobalVariable(k, v);
                });
            }

            // 2.4. Visual Debug Path (Phase 4)
            const debugEmoji = iterations === 1 ? '🚀' : '➡️';
            console.log(`\x1b[36m[DEBUG-PATH] ${debugEmoji} Node: ${currentNode.id} (${currentNode.type})${result.conditionResult !== undefined ? ` | Condition: ${result.conditionResult}` : ''}\x1b[0m`);

            // SPECIAL CASE: Flow Link (Switching flows)
            if (currentNode.type === 'flowLinkNode' && currentNode.data?.flowId) {
                const targetFlowId = currentNode.data.flowId;
                logger.info(`[FlowEngine] Switching flow for session ${session.id} -> ${targetFlowId}`);

                // Pasar variables explícitas al flujo destino. Formato: "nombre, edad" o
                // "nombre:cliente" (renombra). Se guardan en el namespace compartido para
                // que el flujo destino las lea con {{nombre}} sin volver a pedirlas.
                const passSpec = String(currentNode.data.passVariables || currentNode.data.pass_variables || '').trim();
                if (passSpec) {
                    for (const part of passSpec.split(',')) {
                        const [src, dst] = part.split(':').map((s) => s.trim());
                        if (!src) continue;
                        const val = session.getVariable(src);
                        if (val !== undefined && val !== null) {
                            session.setGlobalVariable(dst || src, val);
                            logger.info(`[FlowEngine] [flowLink] pasando "${src}"${dst ? ` → "${dst}"` : ''} = "${val}"`);
                        }
                    }
                }

                // Switch context/flow in session
                session.getContext().metadata.flowId = targetFlowId;
                session.currentNodeId = 'start'; // Jump to start of new flow

                // We continue the loop with the new flow
                continue;
            }
            const messages = result.messages || [];
            if (messages.length > 0) {
                logger.info(`[FlowEngine] [OUTPUT] Node ${currentNode.id} generated ${messages.length} messages`);
            }
            accumulatedMessages.push(...messages);

            // Audit Step to DB (Phase 4) - Non-blocking to prevent timeouts
            this.logStepToDB(accountId, session, currentNode, result, stepDuration);

            // SPECIAL CASE: AI Flow Control (Return to previous)
            if (result.updatedContext?.last_ai_completed) {
                const logs = session.getContext().interactionLog;
                const prevNode = [...logs].reverse().find(l => l.nodeId !== currentNode.id);
                if (prevNode) {
                    logger.info(`[FlowEngine] [AI RETURN] Returning to previous node ${prevNode.nodeId}`);
                    session.currentNodeId = prevNode.nodeId;
                    // We let it continue to execute the previous node (which will likely wait for input)
                    continue;
                }
            }

            if (result.wait_for_input) {
                console.log(`\x1b[33m[DEBUG-PATH] ⏸️ Waiting for input at ${currentNode.id}\x1b[0m`);
                session.status = 'waiting_input';
                break;
            }

            // Advance
            const handle = result.conditionResult !== undefined ? String(result.conditionResult) : undefined;
            const nextNodeId = this.findNextNodeId(flow, session.currentNodeId, handle);

            if (!nextNodeId) {
                console.log(`\x1b[32m[DEBUG-PATH] ✅ Flow Finished at ${currentNode.id}\x1b[0m`);
                session.status = 'completed';
                await this.sessionRepository.archive(accountId, session.id, 'flow_completed');
                break;
            }

            session.currentNodeId = nextNodeId;
        }

        return accumulatedMessages;
    }

    private findNextNodeId(flow: FlowDefinition, currentNodeId: string, handle?: string): string | null {
        const edges = flow.edges || [];
        const normalizedHandle = handle ? String(handle).toLowerCase().trim() : undefined;

        let edge;
        if (normalizedHandle) {
            edge = edges.find((e: any) => {
                if (e.source !== currentNodeId) return false;
                const srcHandle = String(e.sourceHandle || '').toLowerCase().trim();

                // 1. Direct match
                if (srcHandle === normalizedHandle) return true;

                // 2. Boolean synonyms (SUCCESS/TRUE/OK/CENTRO/CONFIRMED)
                const isPositive = ['true', 'yes', 'ok', 'success', 'centro', '1', 'confirmed', 'correcto'].includes(normalizedHandle);
                const srcPositive = ['true', 'yes', 'ok', 'success', 'centro', '1', 'confirmed', 'correcto'].includes(srcHandle);
                if (isPositive && srcPositive) return true;

                // 3. Negative synonyms (FAIL/FALSE/ERROR/FUERA DE ZONA/CANCELAR)
                const isNegative = ['false', 'no', 'fail', 'error', 'fuera de zona', 'fuera', '0', 'cancel', 'cancelar'].includes(normalizedHandle);
                const srcNegative = ['false', 'no', 'fail', 'error', 'fuera de zona', 'fuera', '0', 'cancel', 'cancelar'].includes(srcHandle);
                if (isNegative && srcNegative) return true;

                return false;
            });

            if (!edge) {
                logger.warn(`[FlowEngine] [MEMORY-LOSS-WARNING] Node "${currentNodeId}" returned handle "${handle}", but NO matching edge found. Synonyms check also failed.`);
            }
        }

        // 4. Defaulting logic:
        // If we found an edge via handle, use it.
        // If NOT, only default to the first connection if the handle was undefined (linear path)
        // OR if the node is NOT a branching node.
        if (!edge) {
            const node = (flow.nodes || []).find((n: any) => n.id === currentNodeId);
            const isBranchingNode = ['pollNode', 'conditionNode', 'locationValidatorNode', 'orderValidatorNode', 'arraySwitchNode', 'switchNode', 'keywordNode', 'intentResolverNode', 'genderNode'].includes(node?.type || '');

            if (!handle || !isBranchingNode) {
                edge = edges.find((e: any) => e.source === currentNodeId);
            } else {
                logger.error(`[FlowEngine] [STRICT-MODE] Branching node "${currentNodeId}" produced unhandled result "${handle}". Aborting branch to prevent wrong path execution.`);
            }
        }

        return edge ? edge.target : null;
    }

    private async getAllActiveFlows(accountId: string): Promise<{ data: any[] }> {
        const now = Date.now();
        const cached = FlowEngine.flowListCache.get(accountId);
        if (cached && (now - cached.timestamp < FlowEngine.CACHE_TTL)) {
            return { data: cached.data };
        }

        const isMemoryAccount = memoryAccounts.has(accountId);
        const useSupabase = isSupabaseConfigured && !isMemoryAccount;

        let activeFlows: any[] = [];

        if (useSupabase) {
            try {
                // ORG-WIDE: los flujos son del estudio (single-org), compartidos por todos
                // los canales (WhatsApp/FB/IG). No se filtra por account_id: una cuenta sin
                // flujos propios (p.ej. FB/IG recién conectados) usa los mismos del estudio.
                const { data } = await this.db
                    .from('flows')
                    .select('id, name, trigger_word, is_active, nodes')
                    .eq('is_active', true);
                if (data) activeFlows = data;
            } catch (err) {
                // fallback
            }
        }

        if (activeFlows.length === 0) {
            activeFlows = Array.from(memoryFlows.values()).filter(
                f => f.account_id === accountId && f.is_active
            );
        }

        // No cachear una lista vacía: un hipo transitorio de la query (o un fetch
        // antes de que existan los flujos) cachearía vacío por CACHE_TTL y dejaría
        // al bot mudo ("No flow matched") durante esa ventana. Si vino vacío, no
        // pisamos el cache: el próximo mensaje reintenta la query.
        if (activeFlows.length > 0) {
            FlowEngine.flowListCache.set(accountId, { data: activeFlows, timestamp: now });
        }
        return { data: activeFlows };
    }

    private async getFlowDefinition(accountId: string, flowId: string): Promise<FlowDefinition | null> {
        if (!flowId) return null;

        const cacheKey = `${accountId}:${flowId}`;
        const now = Date.now();
        const cached = FlowEngine.flowCache.get(cacheKey);
        if (cached && (now - cached.timestamp < FlowEngine.CACHE_TTL)) {
            return cached.definition;
        }

        const isMemoryAccount = memoryAccounts.has(accountId) || memoryFlows.has(flowId);
        const useSupabase = isSupabaseConfigured && !isMemoryAccount;

        let flow = null;

        if (useSupabase) {
            try {
                // ORG-WIDE: se resuelve el flujo por id sin atar a account_id, para que los
                // flowLink (router → sub-flujos) funcionen desde cualquier canal del estudio.
                const { data } = await this.db
                    .from('flows')
                    .select('*')
                    .eq('id', flowId)
                    .maybeSingle();
                if (data) flow = data;
            } catch (err) {
                // fallback
            }
        }

        if (!flow) {
            flow = memoryFlows.get(flowId) || null;
        }

        if (flow) {
            FlowEngine.flowCache.set(cacheKey, { definition: flow, timestamp: now });
        }
        return flow;
    }

    private async findFlowByTrigger(accountId: string, text: string): Promise<{ flow: FlowDefinition | null, isWildcard: boolean }> {
        const cleanText = (text || '').trim().toLowerCase();

        // 1. Fetch from cached list
        const { data } = await this.getAllActiveFlows(accountId);
        if (!data || data.length === 0) return { flow: null, isWildcard: false };

        // 2. Try EXACT match first
        const exactMatch = data.find((f: any) => {
            if (!f.trigger_word) return false;
            const triggers = f.trigger_word.toLowerCase().split(',').map((t: string) => t.trim());
            return triggers.includes(cleanText);
        });
        if (exactMatch) return { flow: exactMatch, isWildcard: false };

        // 3. Try PARTIAL match (if message contains the trigger word)
        const partialMatch = data.find((f: any) => {
            if (!f.trigger_word || f.trigger_word === '*') return false;
            const triggers = f.trigger_word.toLowerCase().split(',').map((t: string) => t.trim());
            return triggers.some((t: string) => cleanText.includes(t) && t.length > 2); // Avoid matching tiny words
        });
        if (partialMatch) return { flow: partialMatch, isWildcard: false };

        // 4. ✨ WILDCARD / CATCH-ALL match (* or empty string) ✨
        // Any flow with no trigger word, or an asterisk, is considered a catch-all.
        const wildcardMatch = data.find((f: any) => {
            if (!f.trigger_word) return true; // Empty string or null is a catch-all
            const triggers = f.trigger_word.split(',').map((t: string) => t.trim());
            return triggers.includes('*') || triggers.includes('');
        });

        if (wildcardMatch) {
            logger.info(`[FlowEngine] No specific trigger match for "${cleanText}". Routing to Catch-all flow: "${wildcardMatch.name}" (*)`);
            return { flow: wildcardMatch, isWildcard: true };
        }

        return { flow: null, isWildcard: false };
    }

    /**
     * Resuelve el voto de una encuesta comparando el hash recibido con las opciones del nodo actual.
     */
    async resolvePollVote(accountId: string, phone: string, voteHashStr: string): Promise<string | null> {
        const cleanPhone = PhoneUtils.normalize(phone);
        const sessionId = `1to1:${cleanPhone}`;

        const isMemoryAccount = memoryAccounts.has(accountId);
        let execution = null;

        if (isSupabaseConfigured && !isMemoryAccount) {
            try {
                const { data } = await this.db
                    .from('flow_executions')
                    .select('*')
                    .eq('account_id', accountId)
                    .eq('session_id', sessionId)
                    .in('status', ['active', 'waiting_input'])
                    .maybeSingle();
                execution = data;
            } catch (err) {
                // fallback
            }
        }

        if (!execution) {
            try {
                const session = await this.sessionRepository.findActiveSession(accountId, sessionId);
                if (session) {
                    execution = {
                        flow_id: session.getContext().metadata.flowId,
                        current_node_id: session.currentNodeId
                    };
                }
            } catch (err) {
                // fallback
            }
        }

        if (!execution || !execution.flow_id) return null;

        // 2. Get Flow & Node
        let flow = null;
        if (isSupabaseConfigured && !isMemoryAccount && !memoryFlows.has(execution.flow_id)) {
            try {
                const { data } = await this.db
                    .from('flows')
                    .select('nodes')
                    .eq('account_id', accountId)
                    .eq('id', execution.flow_id)
                    .single();
                flow = data;
            } catch (err) {
                // fallback
            }
        }

        if (!flow) {
            flow = memoryFlows.get(execution.flow_id) || null;
        }

        if (!flow) return null;

        const currentNode = (flow.nodes || []).find((n: any) => n.id === execution.current_node_id);
        if (!currentNode || currentNode.type !== 'pollNode') return null;

        // 3. Reconstruct Options
        const options = currentNode.data.options || ['Si', 'No'];

        // 4. Calculate Hashes and Match
        const crypto = require('crypto');
        const incoming = voteHashStr.toUpperCase();

        // Clean input: remove common WhatsApp markdown (*, _) and trim
        const val1 = incoming.replace(/[\*_]/g, '').trim().toLowerCase();

        // Extract numeric part (e.g. from "1." or "*1.*" or "opción 1")
        const numericMatch = val1.match(/\d+/);
        const extractedNum = numericMatch ? numericMatch[0] : null;
        const optionIndex = extractedNum ? parseInt(extractedNum) - 1 : -1;

        const cleanIncoming = incoming.replace(/[^\w\s]/g, '').trim().toLowerCase();

        for (let i = 0; i < options.length; i++) {
            const opt = options[i];
            const cleanOpt = opt.replace(/[^\w\s]/g, '').trim().toLowerCase();

            // 1. Hash match (for actual Poll votes)
            const shasum = crypto.createHash('sha256');
            shasum.update(opt);
            const hash = shasum.digest('hex').toUpperCase();

            // 2. Text match (for text fallbacks)
            if (hash === incoming || incoming.includes(hash) || i === optionIndex || cleanOpt === cleanIncoming || cleanOpt.includes(cleanIncoming)) {
                return opt;
            }
        }

        return null; // No match found
    }

    private async logStepToDB(accountId: string, session: Session, node: any, result: any, duration: number): Promise<void> {
        const isMemoryAccount = memoryAccounts.has(accountId);
        if (!isSupabaseConfigured || isMemoryAccount) {
            logger.info(`[FlowEngine] Step executed (log to console instead of DB): ${node.id} (${node.type})`);
            return;
        }
        try {
            await this.db.from('flow_logs').insert({
                account_id: accountId,
                session_id: session.id,
                phone: session.userPhone,
                flow_id: session.getContext().metadata.flowId,
                node_id: node.id,
                node_type: node.type,
                input_text: session.getContext().interactionLog[session.getContext().interactionLog.length - 1]?.input,
                output_messages: result.messages || [],
                execution_time_ms: duration,
                metadata: {
                    condition_result: result.conditionResult,
                    wait_for_input: result.wait_for_input,
                    vars: session.getAllVariablesForCurrentFlow()
                }
            });
        } catch (err: any) {
            logger.error(`[FlowEngine] Error logging step to DB`, { error: err.message });
        }
    }

    private normalizeInput(text: string): string {
        if (!text) return '';
        // 1. Remove invisible characters and trim
        // 2. Remove common extra symbols but keep numbers and letters
        // 3. Lowercase everything
        return text.trim()
            .replace(/[​-‍﻿]/g, '') // Invisible chars
            .replace(/[^\w\sáéíóúüñ]/gi, '') // Keep letters/numbers/spaces
            .toLowerCase();
    }

    async resumeSession(accountId: string, phone: string, context: any = {}): Promise<any> {
        const cleanPhone = PhoneUtils.normalize(phone);
        const remoteJid = context.remoteJid || PhoneUtils.toJid(phone);
        const sessionId = remoteJid.endsWith('@g.us') ? `group:${remoteJid}` : `1to1:${cleanPhone}`;

        const { data: existing } = await this.db.from('flow_executions')
            .select('*').eq('account_id', accountId).eq('session_id', sessionId).in('status', ['active', 'waiting_input']).limit(1).maybeSingle();

        if (!existing) return null;

        const session = Session.fromJSON(existing);
        const resultMessages = await this.executeNodeChain(accountId, session);
        await this.sessionRepository.update(accountId, session);

        return { currentStateDefinition: { message_template: resultMessages } };
    }
}

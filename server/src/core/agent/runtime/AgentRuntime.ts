import type { ToolContext } from './types';
import { buildCalificacionFicha } from './ContactMemory';
import {
  normalizeLoopGuardConfig,
  evaluateRate,
  isEchoReply,
  recordCall,
  recordReply,
  type LoopGuardState,
} from './LoopGuard';
import type { AreaKey } from '../context/AreaDetector';

const MAX_ITERATIONS = 5;
const FALLBACK = 'Disculpá, esto mejor lo ve una persona del estudio. Ya te derivo.';

// Dependencias inyectadas (facilita el test y respeta el aislamiento).
export interface RuntimeDeps {
  ai: { completeWithTools: (opts: any) => Promise<{ content?: string; toolCalls?: Array<{ id: string; name: string; args: any }> }> };
  persona: { build: (account: any, fichaText: string, continuityBlock?: string) => string };
  memory: { load: (accountId: string, phone: string) => Promise<{ fichaText: string; calificacion?: Record<string, any> | null }> };
  tools: { schemas: () => any[]; execute: (name: string, args: any, ctx: ToolContext) => Promise<{ ok: boolean; data?: any; error?: string }> };
  loadAccount: (accountId: string) => Promise<any>;
  history: (accountId: string, phone: string) => Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  updateMemory?: (accountId: string, phone: string, turns: Array<{ role: string; content: string }>) => Promise<void>;
  // Continuidad (Capacidad 1): contexto del contacto + bloque para el system prompt.
  contextLoader?: { load: (accountId: string, phone: string) => Promise<any> };
  buildContinuity?: (ctx: any) => string;
  // Agendado determinístico: el LLM dispara start_booking, el resto lo conduce esto.
  booking?: {
    isActive: (accountId: string, phone: string) => Promise<boolean>;
    advance: (accountId: string, phone: string, text: string, conversation: string) => Promise<{ messages: string[]; active: boolean }>;
    start: (accountId: string, phone: string, args: any, conversation: string) => Promise<{ messages: string[]; active: boolean }>;
  };
  // Gate determinístico de intención: arranca el agendado sin esperar al LLM.
  bookingIntent?: (text: string) => { start: boolean; modalidad?: 'presencial' | 'video' };
  // Clasifica el área de la consulta. Si el mensaje toca un área de calificación,
  // el gate NO arranca el booking determinístico (deja calificar al LLM/libreto).
  areaDetector?: (text: string) => AreaKey | null;
  // Capa de interpretación + dialogue state (controller manda): corre ANTES del
  // tool-loop. 'resolved' → el turno ya está resuelto (no se llama al LLM con tools).
  // 'advance' → delega al tool-loop (set_qualification / start_booking / FAQ).
  conversation?: {
    handleTurn: (accountId: string, phone: string, text: string) =>
      Promise<{ kind: 'resolved'; messages: string[] } | { kind: 'advance' }>;
  };
  // LoopGuard: tope de llamadas IA por contacto (config en account.loopGuard).
  // Sin esto, el guard queda inactivo (comportamiento previo intacto).
  loopGuard?: {
    loadState: (accountId: string, phone: string) => Promise<LoopGuardState | null>;
    saveState: (accountId: string, phone: string, state: LoopGuardState) => Promise<void>;
    onBlock?: (accountId: string, phone: string, reason: 'rate' | 'echo') => Promise<void>;
  };
  // Reloj inyectable (test). Default: Date.now.
  now?: () => number;
}

export class AgentRuntime {
  constructor(private deps: RuntimeDeps) {}

  /** Procesa un mensaje entrante y devuelve los mensajes a enviar. */
  async handle(accountId: string, phone: string, text: string, _fileCtx: any = {}): Promise<string[]> {
    const ctx: ToolContext = { accountId, phone };
    const [account, ficha, history, convCtx] = await Promise.all([
      this.deps.loadAccount(accountId),
      this.deps.memory.load(accountId, phone),
      this.deps.history(accountId, phone),
      this.deps.contextLoader?.load(accountId, phone).catch(() => null) ?? Promise.resolve(null),
    ]);

    // FB/IG: el "phone" del contacto es el id de la red (PSID/IGSID), NO un teléfono.
    // El agendado debe pedir el número real en el chat (needsPhone). WhatsApp ya lo tiene.
    const needsPhone = !!(account as any)?.channel && (account as any).channel !== 'whatsapp';

    // Bloque de continuidad ("este contacto ya habló antes, retomá") al system prompt.
    const continuity = convCtx && this.deps.buildContinuity ? this.deps.buildContinuity(convCtx) : '';
    // Calificación previa vigente (< TTL por cuenta) → a la ficha, para no re-preguntar.
    const msgArea = this.deps.areaDetector?.(text) ?? null;
    const ttlDays = Number((account as any)?.calificacionTtlDays) || 30;
    const calBlock = buildCalificacionFicha(ficha.calificacion, msgArea, ttlDays, (this.deps.now ?? Date.now)());
    const fichaText = calBlock ? `${ficha.fichaText}\n${calBlock}` : ficha.fichaText;
    const systemPrompt = this.deps.persona.build(account, fichaText, continuity);
    const tools = this.deps.tools.schemas();
    const messages: any[] = [...history, { role: 'user', content: text }];

    // LoopGuard: tope de llamadas IA por contacto. El guard solo aplica al camino
    // del LLM (el agendado determinístico no consume API). Estado persistido por el caller.
    const lg = this.deps.loopGuard;
    const lgCfg = normalizeLoopGuardConfig(account?.loopGuard);
    const now = (this.deps.now ?? Date.now)();
    let lgState: LoopGuardState = lg
      ? ((await lg.loadState(accountId, phone).catch(() => null)) ?? { calls: [], replies: [] })
      : { calls: [], replies: [] };

    // Conversación textual para que book_appointment arme la ficha IA (Capacidad 2).
    ctx.conversation = messages
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
      .map((m) => `${m.role === 'user' ? 'Cliente' : 'Asistente'}: ${m.content}`)
      .join('\n');

    const finishWith = (replies: string[]): string[] => {
      // Turno silencioso (conversación cerrada / LoopGuard silence-cooldown): no hay
      // respuesta nueva → nada que memorizar → NO gastar una llamada IA en updateMemory.
      if (replies.length > 0) {
        const turns = messages
          .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
          .map((m) => ({ role: m.role, content: m.content }));
        for (const r of replies) turns.push({ role: 'assistant', content: r });
        this.deps.updateMemory?.(accountId, phone, turns)?.catch(() => { /* best-effort */ });
      }
      lg?.saveState(accountId, phone, lgState).catch(() => { /* best-effort */ });
      return replies;
    };
    const finish = (reply: string): string[] => finishWith([reply]);

    // Aplica la acción configurada al tocar el tope del LoopGuard.
    const block = (reason: 'rate' | 'echo'): string[] => {
      if (lgCfg.action === 'handoff') {
        lg?.onBlock?.(accountId, phone, reason).catch(() => { /* best-effort */ });
        return finish(FALLBACK);
      }
      // 'silence' y 'cooldown': no responde (cooldown se libera solo al pasar la ventana).
      return finishWith([]);
    };

    // Agendado en curso: el state machine determinístico conduce, sin pasar por el LLM.
    // (La fase 'agendado' está DELEGADA a BookingFlow; el controller no interfiere a medio agendar.)
    if (this.deps.booking && (await this.deps.booking.isActive(accountId, phone).catch(() => false))) {
      const r = await this.deps.booking.advance(accountId, phone, text, ctx.conversation ?? text);
      if (r.messages.length) return finishWith(r.messages);
    } else {
      // Capa de interpretación (controller manda): interpreta intención + slot-filling
      // determinístico ANTES del tool-loop. Resuelve opt-out / cierre / frustración /
      // off-topic / preguntas de calificación sin tocar el LLM-con-tools.
      if (this.deps.conversation) {
        const outcome = await this.deps.conversation.handleTurn(accountId, phone, text).catch(() => ({ kind: 'advance' as const }));
        if (outcome.kind === 'resolved') return finishWith(outcome.messages);
        // 'advance' → sigue al gate de booking pelado + tool-loop de abajo.
      }
      // Gate de turno NUEVO sin área (pedido "pelado"): lo arranca el flujo determinístico.
      // Si el mensaje toca un área de calificación, NO se arranca: el LLM/libreto califica primero.
      if (this.deps.booking && this.deps.bookingIntent) {
        const intent = this.deps.bookingIntent(text);
        if (intent.start) {
          const area = this.deps.areaDetector?.(text) ?? null;
          if (!area) {
            const r = await this.deps.booking.start(accountId, phone, { modalidad: intent.modalidad, needsPhone }, ctx.conversation ?? text);
            if (r.messages.length) return finishWith(r.messages);
          }
        }
      }
    }

    // Tope de llamadas IA: si el contacto ya superó el cupo, no llamamos al LLM.
    // El agendado de arriba es determinístico y queda exento (no consume API).
    if (lg && evaluateRate(lgState, lgCfg, now).blocked) return block('rate');
    // Esta vuelta cuenta como una llamada IA (el loop interno de tools ya está
    // capado por MAX_ITERATIONS; el tope global es por turno de conversación).
    if (lg) lgState = recordCall(lgState, lgCfg, now);

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      let res: { content?: string; toolCalls?: Array<{ id: string; name: string; args: any }> };
      try {
        res = await this.deps.ai.completeWithTools({
          systemPrompt, messages, tools, apiKey: account?.apiKey, model: account?.model,
        });
      } catch {
        // Todos los proveedores de IA fallaron (sin saldo, caídos, timeout):
        // nunca colgar al cliente — respondemos con cortesía y derivamos.
        return finish(FALLBACK);
      }

      if (!res.toolCalls?.length) {
        const reply = res.content && res.content.trim() ? res.content.trim() : FALLBACK;
        // Anti-eco: si el modelo repite una respuesta reciente casi idéntica,
        // no la reenviamos (corta el loop de re-presentación) y aplicamos la acción.
        if (lg && isEchoReply(lgState, reply, lgCfg)) return block('echo');
        if (lg) lgState = recordReply(lgState, lgCfg, reply);
        return finish(reply);
      }

      // El modelo dispara el agendado: a partir de acá conduce el flujo determinístico.
      const startCall = res.toolCalls.find((c) => c.name === 'start_booking');
      if (this.deps.booking && startCall) {
        const r = await this.deps.booking.start(accountId, phone, { ...(startCall.args ?? {}), needsPhone }, ctx.conversation ?? text);
        if (r.messages.length) return finishWith(r.messages);
      }

      messages.push({ role: 'assistant', content: '', tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
      for (const call of res.toolCalls) {
        if (call.name === 'start_booking') { messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify({ ok: true, data: { started: true } }) }); continue; }
        const result = await this.deps.tools.execute(call.name, call.args, ctx);
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(result) });
      }
    }

    // Excedió iteraciones: cortar y derivar (nunca colgar al cliente).
    return finish(FALLBACK);
  }
}

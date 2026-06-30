import { AgentRuntime } from './AgentRuntime';
import { ToolRegistry } from './ToolRegistry';
import { KnowledgeBase } from './KnowledgeBase';
import { ContactMemory } from './ContactMemory';
import { buildPersona } from './AgentPersona';
import { AIService } from '../../../services/AIService';
import { extractMemoryPatch } from './MemoryUpdater';
import { AppointmentService } from '../../../services/AppointmentService';
import { AvailabilityService } from '../../../services/AvailabilityService';
import { supabase } from '../../../config/supabase';
import { redisPersistence } from '../../../infrastructure/persistence/RedisPersistenceService';
import { ConversationContextLoader, buildContinuityBlock, type OpenAppointment } from '../context/ConversationContextLoader';
import { ZoneResolver } from '../context/ZoneResolver';
import { OfferedOptionsStore } from '../context/OfferedOptionsStore';
import { buildReceptionFicha } from '../context/ReceptionFichaBuilder';
import { BookingService } from '../context/BookingService';
import { BookingStateStore } from '../context/BookingStateStore';
import { detectBookingIntent } from '../context/BookingFlow';
import { detectArea } from '../context/AreaDetector';
import { ConversationController } from './ConversationController';
import { classifyIntent } from '../context/IntentClassifier';

// Redacta UN mensaje (pregunta de slot / redirección off-topic) con la persona REAL
// del estudio + el OBJETIVO inyectado por el controller. El LLM SOLO redacta; el flujo
// lo decide el código.
async function redactarMensaje(objetivo: string, accountId?: string): Promise<string> {
  let sys: string;
  if (accountId) {
    const account = await loadAccount(accountId).catch(() => null);
    sys = account
      ? buildPersona(account, 'FICHA: (redacción puntual).', '', objetivo)
      : `Secretaria de un estudio jurídico previsional/laboral, de "usted", cálida. OBJETIVO: ${objetivo}. Respondé SOLO ese mensaje, una sola frase.`;
  } else {
    sys = `Secretaria de un estudio jurídico previsional/laboral, de "usted", cálida. OBJETIVO: ${objetivo}. Respondé SOLO ese mensaje, una sola frase.`;
  }
  try {
    const out = await AIService.complete({ systemPrompt: sys, userMessage: objetivo, temperature: 0.3, maxTokens: 120 });
    return (out && out.trim()) || '¿Me puede dar ese dato, por favor?';
  } catch {
    return '¿Me puede dar ese dato, por favor?';
  }
}

const TZ = 'America/Argentina/Buenos_Aires';

// Próxima cita vigente del contacto (para el bloque de continuidad).
async function nextAppointment(accountId: string, phone: string): Promise<OpenAppointment | null> {
  try {
    const appts = await AppointmentService.list(accountId);
    const now = Date.now();
    const next = appts
      .filter((a) => a.phone === phone && a.status !== 'cancelada' && a.start_time && new Date(a.start_time).getTime() > now)
      .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())[0];
    if (!next?.start_time) return null;
    return {
      id: next.id, start_time: next.start_time, oficina: next.oficina, status: next.status,
      fechaTexto: new Date(next.start_time).toLocaleString('es-AR', {
        weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        hour12: false, timeZone: TZ,
      }),
    };
  } catch { return null; }
}

async function loadAccount(accountId: string) {
  const { data, error } = await supabase.from('accounts')
    .select('id, name, agent_name, agent_persona, business_context, agent_procedures, ai_api_key, ai_model, agent_loop_guard, calificacion_ttl_days')
    .eq('id', accountId).maybeSingle();

  // Columna calificacion_ttl_days aún no migrada (0030 pendiente): recaer al select
  // sin ella para NO perder la config de cuenta mientras la migración no está aplicada.
  let row: any = data;
  if (error) {
    const { data: d2 } = await supabase.from('accounts')
      .select('id, name, agent_name, agent_persona, business_context, agent_procedures, ai_api_key, ai_model, agent_loop_guard')
      .eq('id', accountId).maybeSingle();
    row = d2;
  }

  return {
    accountId,
    agentName: row?.agent_name ?? 'Sofía',
    agentPersona: row?.agent_persona ?? null,
    businessContext: row?.business_context ?? null,
    agentProcedures: row?.agent_procedures ?? null,
    estudioNombre: row?.name ?? null,
    apiKey: row?.ai_api_key ?? null,
    model: row?.ai_model ?? null,
    // Config del LoopGuard (jsonb). null → el runtime usa los defaults.
    loopGuard: (row as any)?.agent_loop_guard ?? null,
    calificacionTtlDays: (row as any)?.calificacion_ttl_days ?? 30,
  };
}

// Historial reciente como Array<{role:'user'|'assistant', content}>.
// Fuente real: RedisPersistenceService.getHistory, que ya mapea
// direction OUTBOUND→'assistant', INBOUND→'user' desde whatsapp_messages.
async function recentHistory(accountId: string, phone: string): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const rows = await redisPersistence.getHistory(accountId, phone, 12);
  return (rows ?? [])
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
}

// Reutiliza la lógica real de handover (la misma que HandoverExecutor /
// ConversationRouter.setHandover): pone flow_executions + whatsapp_conversations
// en HANDOVER para que el bot calle y la conversación pase a Atención. Best-effort.
async function handoff(accountId: string, phone: string, _payload: { motivo: string; resumen_caso: string }): Promise<void> {
  try {
    await supabase.from('flow_executions')
      .update({ status: 'HANDOVER' })
      .eq('account_id', accountId)
      .eq('phone', phone)
      .eq('status', 'active');
    await supabase.from('whatsapp_conversations')
      .update({ status: 'HANDOVER', updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('phone', phone);
  } catch (e: any) {
    console.warn(`[createAgentRuntime] handoff error for ${phone}:`, e?.message || e);
  }
}

let singleton: AgentRuntime | null = null;
export function getAgentRuntime(): AgentRuntime {
  if (singleton) return singleton;
  const knowledge = new KnowledgeBase();
  const memory = new ContactMemory();
  const availability = new AvailabilityService();
  const zone = new ZoneResolver();
  const offered = new OfferedOptionsStore();

  const tools = new ToolRegistry({
    appointments: AppointmentService, knowledge, availability, handoff,
    // Capacidad 3: geo-routing.
    suggestOffice: (accountId, texto) => zone.suggest(accountId, texto),
    // Capacidad 4: opciones ofrecidas.
    offered: { set: (a, p, opts) => offered.set(a, p, opts), get: (a, p) => offered.get(a, p) },
    // Capacidad 2: ficha IA al agendar. Usa gpt-4o (structured extraction de calidad).
    buildFicha: (conversation, ctx) =>
      buildReceptionFicha({ complete: (o) => AIService.complete(o) }, { conversation, ctx, model: 'gpt-4o' })
        .then((f) => ({ resumen_ia: f.resumen_ia, perfil: f })),
    setCalificacion: (a, p, area, entry) => memory.setCalificacion(a, p, area, entry),
  });

  // Capacidad 1: loader de continuidad.
  const contextLoader = new ConversationContextLoader({
    loadMemory: (a, p) => memory.loadExtended(a, p),
    history: recentHistory,
    nextAppointment,
    offeredOptions: (a, p) => offered.get(a, p),
  });

  // Agendado determinístico: reusa book_appointment del ToolRegistry (capacidad,
  // profesional, ficha IA) → cero duplicación de la lógica de reserva.
  const booking = new BookingService({
    store: new BookingStateStore(),
    suggestOffice: (a, t) => zone.suggest(a, t),
    listOffices: (a) => availability.listOffices(a).then((offs) => offs.map((o) => ({ nombre: o.nombre, modalidad: o.modalidad }))),
    freeSlots: (a, oficina, opts) => availability.freeSlots(a, oficina, { max: opts?.max ?? 3, ...(opts?.desde ? { now: opts.desde } : {}) }),
    book: async (a, phone, conversation, _zona, b) => {
      // zona NO se thread-ea cruda: que gpt-4o extraiga la localidad limpia del diálogo.
      const r = await tools.execute('book_appointment',
        { nombre: b.nombre, start_time: b.start, end_time: b.end, oficina: b.oficina, resumen: '' },
        { accountId: a, phone, conversation });
      if (!r.ok) throw new Error(r.error || 'sin cupo');
      return { direccion: r.data?.direccion ?? null, video_link: r.data?.video_link ?? null, modalidad: r.data?.modalidad };
    },
  });

  // Capa de interpretación (controller manda): interpreta intención + slot-filling
  // determinístico antes del tool-loop. El LLM solo clasifica (IntentClassifier) y
  // redacta (redactarMensaje). El control de flujo es 100% código.
  const conversationController = new ConversationController({
    classify: (text, cctx) => classifyIntent({ complete: (o) => AIService.complete(o) }, { text, ctx: cctx }),
    history: (a, p) => recentHistory(a, p),
    loadState: (a, p) => memory.getDialogueState(a, p),
    saveState: (a, p, s) => memory.saveDialogueState(a, p, s),
    setOptOut: (a, p) => memory.setOptOut(a, p),
    closeConversation: (a, p, motivo) => memory.closeConversation(a, p, motivo),
    handoff: (a, p, payload) => handoff(a, p, payload),
    redactar: (objetivo, rctx) => redactarMensaje(objetivo, rctx?.accountId),
    detectArea,
    now: () => new Date().toISOString(),
  });

  singleton = new AgentRuntime({
    ai: { completeWithTools: (o) => AIService.completeWithTools(o) },
    persona: { build: buildPersona },
    memory: { load: (a, p) => memory.load(a, p) },
    tools: { schemas: () => tools.schemas(), execute: (n, args, ctx) => tools.execute(n, args, ctx) },
    loadAccount,
    history: recentHistory,
    contextLoader: { load: (a, p) => contextLoader.load(a, p) },
    buildContinuity: buildContinuityBlock,
    booking: {
      isActive: (a, p) => booking.isActive(a, p),
      advance: (a, p, t, c) => booking.advance(a, p, t, c),
      start: (a, p, args, c) => booking.start(a, p, args, c),
    },
    bookingIntent: detectBookingIntent,
    areaDetector: detectArea,
    conversation: { handleTurn: (a, p, t) => conversationController.handleTurn(a, p, t) },
    // LoopGuard: estado persistido en contact_memory (sobrevive reinicios del VPS);
    // al tocar el tope con action=handoff reusa el handover real (bot calla, pasa a Atención).
    loopGuard: {
      loadState: (a, p) => memory.loadLoopGuardState(a, p),
      saveState: (a, p, s) => memory.saveLoopGuardState(a, p, s),
      onBlock: (a, p, reason) => handoff(a, p, {
        motivo: reason === 'echo' ? 'loop_guard_echo' : 'loop_guard_rate',
        resumen_caso: 'Tope de respuestas IA alcanzado — derivado para evitar loop.',
      }),
    },
    updateMemory: async (accountId, phone, turns) => {
      const patch = await extractMemoryPatch({ complete: (o) => AIService.complete(o) }, turns);
      await memory.merge(accountId, phone, patch);
    },
  });
  return singleton;
}

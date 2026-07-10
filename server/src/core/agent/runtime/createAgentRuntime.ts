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
import { ZoneResolver, resolveOfficeName } from '../context/ZoneResolver';
import { OfferedOptionsStore } from '../context/OfferedOptionsStore';
import { buildReceptionFicha } from '../context/ReceptionFichaBuilder';
import { BookingService } from '../context/BookingService';
import { BookingStateStore } from '../context/BookingStateStore';
import { detectBookingIntent, detectRescheduleIntent } from '../context/BookingFlow';
import { detectArea } from '../context/AreaDetector';
import { ConversationController } from './ConversationController';
import { classifyIntent } from '../context/IntentClassifier';
import { createDialogueState, buildDatosAportados, slotsPrefill } from '../context/DialogueState';
import { hasCalificacionVigente, pickVigenteCalificacion, QUALIFICATION_AREAS } from '../context/QualificationRules';
import { extractProspect } from '../context/ProspectExtractor';

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
    .select('id, name, channel, agent_name, agent_persona, business_context, agent_procedures, ai_api_key, ai_model, agent_loop_guard, calificacion_ttl_days')
    .eq('id', accountId).maybeSingle();

  // Columna calificacion_ttl_days aún no migrada (0030 pendiente): recaer al select
  // sin ella para NO perder la config de cuenta mientras la migración no está aplicada.
  let row: any = data;
  if (error) {
    const { data: d2 } = await supabase.from('accounts')
      .select('id, name, channel, agent_name, agent_persona, business_context, agent_procedures, ai_api_key, ai_model, agent_loop_guard')
      .eq('id', accountId).maybeSingle();
    row = d2;
  }

  return {
    accountId,
    channel: row?.channel ?? 'whatsapp',
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

  // Booking completado → la conversación queda CERRADA: el próximo "gracias/ok"
  // no dispara ni una llamada IA (silencio del ConversationController).
  const markBookingClosed = async (a: string, p: string): Promise<void> => {
    try {
      const s = (await memory.getDialogueState(a, p)) ?? createDialogueState();
      await memory.saveDialogueState(a, p, { ...s, cerrada: true, cierre_motivo: 'completada', fase: 'cerrada' });
    } catch { /* best-effort */ }
  };
  const availability = new AvailabilityService();
  const zone = new ZoneResolver();
  const offered = new OfferedOptionsStore();

  // Geo-routing con RESOLUCIÓN de nombre: el ZoneResolver devuelve la zona lógica
  // (CABA/Quilmes/Haedo), pero las agendas presenciales se llaman por profesional
  // ("SERENA QUILMES", etc.). Sin traducir, freeSlots(zona) no encuentra la agenda y
  // el presencial cae SIEMPRE a videollamada. resolveOfficeName cierra ese hueco.
  const suggestOfficeResolved = async (a: string, t: string) => {
    const z = await zone.suggest(a, t);
    if (!z.oficina_sugerida) return z;
    const offs = await availability.listOffices(a);
    const real = resolveOfficeName(String(z.oficina_sugerida), offs);
    return real
      ? { ...z, oficina_sugerida: real, necesita_aclaracion: false }
      : { ...z, oficina_sugerida: null }; // zona sin agenda presencial → el flujo ofrece video
  };

  const tools = new ToolRegistry({
    appointments: AppointmentService, knowledge, availability, handoff,
    // Capacidad 3: geo-routing (resuelto a la agenda real).
    suggestOffice: (accountId, texto) => suggestOfficeResolved(accountId, texto),
    // Capacidad 4: opciones ofrecidas.
    offered: { set: (a, p, opts) => offered.set(a, p, opts), get: (a, p) => offered.get(a, p) },
    // Capacidad 2: ficha IA al agendar. Usa gpt-4o (structured extraction de calidad).
    buildFicha: (conversation, ctx) =>
      buildReceptionFicha({ complete: (o) => AIService.complete(o) }, { conversation, ctx, model: 'gpt-4o' })
        .then((f) => ({ resumen_ia: f.resumen_ia, perfil: f })),
    setCalificacion: (a, p, area, entry) => memory.setCalificacion(a, p, area, entry),
    // Fix 4: al agendar, copiar la calificación del ÁREA ACTUAL y VIGENTE (validada) a la cita.
    getCalificacion: async (a, p, area) => {
      try {
        if (!area) return null;
        const m = await memory.load(a, p);
        const acct = await loadAccount(a).catch(() => null);
        return pickVigenteCalificacion(m.calificacion ?? null, area, acct?.calificacionTtlDays ?? 30, Date.now());
      } catch { return null; }
    },
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
    suggestOffice: (a, t) => suggestOfficeResolved(a, t),
    listOffices: (a) => availability.listOffices(a).then((offs) => offs.map((o) => ({ nombre: o.nombre, modalidad: o.modalidad, direccion: o.direccion ?? null }))),
    freeSlots: (a, oficina, opts) => availability.freeSlots(a, oficina, { max: opts?.max ?? 3, ...(opts?.desde ? { now: opts.desde } : {}) }),
    // Video: cascada entre agendas (reglas del estudio: inmediatez + prioridad por día).
    // Con `desde` explícito (el cliente pidió un día/franja) no se suma el lead de 60'.
    videoCascade: (a, opts) => availability.proposeCascade(a, {
      modalidad: 'video',
      max: opts?.max ?? 3,
      minLeadMin: opts?.desde ? 0 : 60,
      ...(opts?.desde ? { now: opts.desde } : {}),
    }),
    book: async (a, phone, conversation, _zona, b) => {
      // zona NO se thread-ea cruda: que gpt-4o extraiga la localidad limpia del diálogo.
      // telefono: número real dado en el chat (FB/IG). Si falta, book_appointment cae al id de canal.
      // area: la de ESTA conversación → book_appointment copia SOLO esa calificación (no otra área/vencida).
      const areaKey = await memory.getDialogueState(a, phone).then((s) => s?.area ?? null).catch(() => null);
      const r = await tools.execute('book_appointment',
        { nombre: b.nombre, start_time: b.start, end_time: b.end, oficina: b.oficina, resumen: '', telefono: b.telefono },
        { accountId: a, phone, conversation, area: areaKey });
      if (!r.ok) throw new Error(r.error || 'sin cupo');
      return { direccion: r.data?.direccion ?? null, video_link: r.data?.video_link ?? null, modalidad: r.data?.modalidad };
    },
    // Reprogramación determinística: reusa reschedule_appointment (ownership + cupo +
    // backstop anti fecha pasada). El start SIEMPRE es un slot REAL del motor de slots.
    reschedule: async (a, phone, conversation, b) => {
      const r = await tools.execute('reschedule_appointment',
        { appointment_id: b.apptId, start_time: b.start, end_time: b.end, oficina: b.oficina },
        { accountId: a, phone, conversation });
      if (!r.ok) throw new Error(r.error || 'no se pudo reprogramar');
      return { direccion: r.data?.direccion ?? null, video_link: r.data?.video_link ?? null, modalidad: r.data?.modalidad };
    },
  });

  // Capa de interpretación (controller manda): interpreta intención + slot-filling
  // determinístico antes del tool-loop. El LLM solo clasifica (IntentClassifier) y
  // redacta (redactarMensaje). El control de flujo es 100% código.
  const conversationController = new ConversationController({
    // gpt-4o para clasificar (más preciso en frases cortas ambiguas que el mini).
    classify: (text, cctx) => classifyIntent({ complete: (o) => AIService.complete(o) }, { text, ctx: cctx, model: 'gpt-4o' }),
    // Extracción profunda en mensajes ricos (1er mensaje / ≥120 chars). gpt-4o:
    // corre poco (tope 1/día por conversación) y es el turno que más plata vale.
    extract: (text, ectx) => extractProspect({ complete: (o) => AIService.complete(o) }, { text, history: ectx.history, model: 'gpt-4o' }),
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
    // Área persistida de la conversación (para podar el libreto por área).
    getArea: (a, p) => memory.getDialogueState(a, p).then((s) => s?.area ?? null).catch(() => null),
    memory: { load: (a, p) => memory.load(a, p) },
    tools: { schemas: () => tools.schemas(), execute: (n, args, ctx) => tools.execute(n, args, ctx) },
    loadAccount,
    history: recentHistory,
    contextLoader: { load: (a, p) => contextLoader.load(a, p) },
    buildContinuity: buildContinuityBlock,
    booking: {
      isActive: (a, p) => booking.isActive(a, p),
      advance: async (a, p, t, c) => {
        const r = await booking.advance(a, p, t, c);
        if (!r.active && r.messages.length) await markBookingClosed(a, p);
        return r;
      },
      start: async (a, p, args, c) => {
        const r = await booking.start(a, p, args, c);
        if (!r.active && r.messages.length) await markBookingClosed(a, p);
        return r;
      },
      // Reprogramación: buscar la próxima cita del contacto y ofrecer slots REALES de su
      // sede. La modalidad de la cita se deriva de la modalidad de su oficina (list_offices).
      startReschedule: async (a, p, text, c) => {
        const appt = await nextAppointment(a, p);
        if (!appt) return { messages: [], active: false };
        const offs = await availability.listOffices(a).catch(() => [] as Array<{ nombre: string; modalidad: string }>);
        const off = offs.find((o) => o.nombre === appt.oficina);
        const modalidad: 'presencial' | 'video' = off?.modalidad === 'video' ? 'video' : 'presencial';
        // needsPhone=false: la cita ya existe con su teléfono; reprogramar no lo re-pregunta.
        const r = await booking.startReschedule(a, p, { apptId: appt.id, modalidad, oficina: appt.oficina ?? undefined, needsPhone: false }, c ?? text, text);
        if (!r.active && r.messages.length) await markBookingClosed(a, p);
        return r;
      },
    },
    canStartBooking: async (a, p) => {
      try {
        const st = await memory.getDialogueState(a, p);
        const area = st?.area ?? null;
        if (!area || !QUALIFICATION_AREAS.has(area)) return { ok: true };
        const { calificacion } = await memory.load(a, p);
        const acct = await loadAccount(a).catch(() => null);
        const ok = hasCalificacionVigente(calificacion, area, acct?.calificacionTtlDays ?? 30, Date.now());
        return ok ? { ok: true } : {
          ok: false,
          reason: 'Todavía no registraste la calificación de esta área. Hacé las preguntas del PROCEDIMIENTO (edad, insalubres/aportes, nacionalidad según corresponda), llamá set_qualification y recién después start_booking.',
        };
      } catch { return { ok: true }; } // best-effort: nunca romper el agendado por un error de lectura
    },
    bookingIntent: detectBookingIntent,
    rescheduleIntent: detectRescheduleIntent,
    areaDetector: detectArea,
    conversation: {
      handleTurn: async (a, p, t) => {
        const o = await conversationController.handleTurn(a, p, t);
        if (o.kind === 'resolved') return o;
        // El estado del turno sale del controller: de ahí el bloque para el prompt
        // y el prefill de agendado (spec extractor P2).
        return {
          kind: 'advance' as const,
          directive: o.directive,
          datosAportados: buildDatosAportados(o.state),
          prefill: slotsPrefill(o.state),
        };
      },
    },
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

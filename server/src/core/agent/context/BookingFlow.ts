// ─── BookingFlow ──────────────────────────────────────────────────────────────
// State machine DETERMINÍSTICO de agendado. El LLM solo reconoce la intención y
// llama start_booking; de ahí en más este reducer conduce los pasos (oficina única
// → slots → elección → nombre → confirmar → agendar) SIN depender del modelo. Así
// se elimina la fricción observada: inventar horarios, "te agendé" sin agendar,
// re-listar, mostrar varias oficinas juntas.
//
// Reducer puro (deps inyectadas, estado in/out): testeable sin Redis ni LLM.

import { resolveOption, type OfferedOption } from './OptionResolver';

const TZ = 'America/Argentina/Buenos_Aires';

export type BookingStage = 'ask_modality' | 'ask_zone' | 'await_slot' | 'ask_name' | 'confirm' | 'done';

export interface BookingState {
  stage: BookingStage;
  modalidad?: 'presencial' | 'video';
  zona?: string | null;
  oficina?: string;
  offered?: OfferedOption[];                                   // slots mostrados (value = start ISO)
  meta?: Record<string, { end: string; profileId?: string | null; oficina: string }>;
  chosenStart?: string;
  nombre?: string;
  desde?: string;                                             // ISO del día desde el que se buscó (para "de tarde" tras "el viernes")
}

export interface BookingSlot { start: string; end: string; profileId?: string | null; oficina?: string }

export interface BookingDeps {
  suggestOffice: (text: string) => Promise<{ oficina_sugerida: string | null; necesita_aclaracion: boolean; pregunta_aclaracion?: string }>;
  videoOfficeName: () => Promise<string | null>;
  // opts.desde: buscar slots desde esa fecha (para "el martes"); opts.max: cantidad.
  freeSlots: (oficina: string, opts?: { desde?: Date; max?: number }) => Promise<BookingSlot[]>;
  book: (b: { nombre: string; start: string; end: string; oficina: string; profileId?: string | null }) => Promise<{ direccion?: string | null; video_link?: string | null; modalidad?: string }>;
}

export interface BookingStep { state: BookingState; messages: string[]; active: boolean }

function fmt(iso: string): string {
  try {
    return new Date(iso).toLocaleString('es-AR', {
      weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: TZ,
    });
  } catch { return iso; }
}

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

// Detección DETERMINÍSTICA de intención de agendar un turno NUEVO. Se usa para
// arrancar el flujo sin depender de que el LLM llame start_booking a tiempo.
const BOOK_WORDS = /\b(turno|cita|agendar|reservar|sacar\s+un|coordinar\s+un|sacarme\s+un)\b/;
const BOOK_PHRASES = /\b(me\s+atiendan|me\s+atienda|que\s+me\s+vean|ser\s+atendid|hablar\s+con\s+(un|una|el|la)\s+(abogad|profesional))\b/;
const NOT_NEW = /\b(cancelar|cancela|reprogramar|reagendar|reagenda|mover|cambiar\s+(mi|el)\s+(turno|cita)|ya\s+tengo\s+(un\s+)?turno)\b/;

export function detectBookingIntent(text: string): { start: boolean; modalidad?: 'presencial' | 'video' } {
  const t = norm(text);
  if (!t || NOT_NEW.test(t)) return { start: false };
  const wants = BOOK_WORDS.test(t) || BOOK_PHRASES.test(t)
    || /\b(quiero|necesito|querria|queria|me\s+gustaria|podria|puedo|quisiera)\b.*\b(turno|cita|atend|atienda|consulta|consultar|asesor)/.test(t);
  if (!wants) return { start: false };
  return { start: true, modalidad: detectModalidad(text) ?? undefined };
}

function detectModalidad(text: string): 'presencial' | 'video' | null {
  const t = norm(text);
  if (/\b(video|videollamada|llamada|virtual|por video|computadora|pantalla|online|telefono|telefonica)\b/.test(t)) return 'video';
  if (/\b(presencial|en persona|ir|me acerco|acercarme|oficina|personalmente|cara a cara)\b/.test(t)) return 'presencial';
  return null;
}

function isAffirmative(text: string): boolean {
  return /\b(si|sip|dale|ok|oka|okey|confirmo|confirma|confirmado|listo|perfecto|de acuerdo|esta bien|asi es|correcto|va|buenisimo|barbaro|joya)\b/.test(norm(text));
}

function isNegative(text: string): boolean {
  return /\b(no|nop|otro|otra|cambiar|mejor otro|distinto|ninguno|ninguna)\b/.test(norm(text));
}

// Hora del slot en horario Argentina (UTC-3), para filtrar mañana/tarde.
function slotHourAR(iso: string): number {
  return (new Date(iso).getUTCHours() - 3 + 24) % 24;
}

const DOW: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

/**
 * Parser DETERMINÍSTICO (sin IA) de un pedido de OTRO día/horario dentro del agendado:
 * "el martes", "mañana", "la semana que viene", "a la tarde", "más tarde", "otra fecha".
 * `now` se inyecta para testear. Devuelve si es un pedido de re-búsqueda + desde/turno.
 */
export function parseSlotRequest(text: string, now: Date = new Date()): { isRequest: boolean; desde?: Date; turno?: 'manana' | 'tarde' } {
  const t = norm(text);
  if (!t) return { isRequest: false };

  // Turno: cualquier mención de "tarde" → tarde. Para mañana exigimos "de/a/por (la)
  // mañana", "la mañana" o "temprano" (así "para mañana" se trata como DÍA, no turno).
  const turno: 'manana' | 'tarde' | undefined =
    /\b(tarde|tardecita|despues de(l)? almuerzo|despues de comer)\b/.test(t) ? 'tarde'
    : /\b((de|a|por)\s+(la\s+)?manana|la manana|manana temprano|temprano|tempranito|al mediodia)\b/.test(t) ? 'manana'
    : undefined;

  const atDay = (target: number): Date => { const d = new Date(now); d.setHours(0, 0, 0, 0); d.setDate(d.getDate() + target); return d; };
  let desde: Date | undefined;

  const iso = t.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (iso) desde = new Date(`${iso[0]}T12:00:00`);

  if (!desde) {
    for (const [name, dow] of Object.entries(DOW)) {
      if (new RegExp(`\\b${name}\\b`).test(t)) { let add = (dow - now.getDay() + 7) % 7; if (add === 0) add = 7; desde = atDay(add); break; }
    }
  }
  if (!desde) {
    if (/\bpasado\s*manana\b/.test(t)) desde = atDay(2);
    else if (/\bmanana\b/.test(t) && !turno) desde = atDay(1); // "mañana" como día (si no era turno)
    else if (/\b(semana que viene|proxima semana|otra semana)\b/.test(t)) desde = atDay(7);
    else if (/\b(otro dia|otra fecha|mas adelante|proximo|siguiente)\b/.test(t)) desde = atDay(1);
  }

  // Es un pedido de re-búsqueda si hay día, turno, o un "otro/más tarde/no me sirve" explícito.
  const otherSignal = /\b(otro|otra|mas tarde|mas temprano|no me sirve|no tenes|no hay|ninguno|ninguna)\b/.test(t);
  return { isRequest: !!(desde || turno || otherSignal), desde, turno };
}

// Extrae un nombre razonable ("mi nombre es Juan Pérez" → "Juan Pérez").
function cleanName(text: string): string {
  let s = (text || '').trim()
    .replace(/^(hola[, ]+)?/i, '')
    .replace(/\b(mi nombre es|me llamo|soy|es|el nombre es|a nombre de|para)\b/gi, '')
    .replace(/[.,;]+$/g, '')
    .trim();
  // Cortar muletillas sueltas.
  s = s.replace(/^(si|sí|dale|ok|buenas)\b[, ]*/i, '').trim();
  return s.slice(0, 60);
}

const SLOT_LABEL = (s: BookingSlot): string => fmt(s.start);

// Etiqueta de cara al CLIENTE: nunca exponemos el nombre interno de la agenda/
// profesional (las oficinas se llaman "DANIELA CANISSA", etc.). El cliente solo ve
// la modalidad.
function lugarLabel(state: BookingState): string {
  return state.modalidad === 'video' ? 'por videollamada' : 'de forma presencial';
}

function showSlotsMessage(state: BookingState, offered: OfferedOption[], lead?: string): string {
  const lines = offered.map((o) => `${o.index}. ${o.label}`).join('\n');
  const head = lead ?? `Estos turnos tengo ${lugarLabel(state)}:`;
  return `${head}\n${lines}\n¿Cuál te queda mejor? Decime el número (1, 2 o 3). 😊`;
}

// Fuera de cobertura → videollamada, avisando el motivo (no exponemos oficinas).
async function farToVideo(state: BookingState, deps: BookingDeps): Promise<BookingStep> {
  const video = await deps.videoOfficeName();
  if (!video) {
    return { state: { ...state, stage: 'ask_modality' }, messages: ['Esa zona nos queda lejos de nuestras oficinas. ¿Lo hacemos por videollamada?'], active: true };
  }
  const step = await loadSlots({ ...state, modalidad: 'video', oficina: video }, deps);
  if (step.messages.length && step.state.stage === 'await_slot') {
    step.messages[0] = `Como esa zona nos queda lejos de nuestras oficinas, lo hacemos por videollamada. ${step.messages[0]}`;
  }
  return step;
}

// Carga slots de UNA oficina y arma el paso await_slot. Si no hay, ofrece alternativa.
// opts.desde: buscar desde otra fecha ("el martes"); opts.turno: filtrar mañana/tarde.
async function loadSlots(state: BookingState, deps: BookingDeps, opts: { desde?: Date; turno?: 'manana' | 'tarde' } = {}): Promise<BookingStep> {
  const oficina = state.oficina!;
  const raw = await deps.freeSlots(oficina, { desde: opts.desde, max: opts.turno ? 30 : 3 });
  let slots = raw.slice(0, 3);
  let lead: string | undefined;
  if (opts.turno) {
    const f = raw.filter((s) => (opts.turno === 'tarde' ? slotHourAR(s.start) >= 13 : slotHourAR(s.start) < 13));
    if (f.length) {
      slots = f.slice(0, 3);
    } else if (raw.length) {
      // No hay del turno pedido, pero sí hay otros ese día: los mostramos con aviso.
      slots = raw.slice(0, 3);
      lead = `No tengo turnos a la ${opts.turno === 'tarde' ? 'tarde' : 'mañana'}${opts.desde ? ' ese día' : ''}, pero ${lugarLabel(state)} tengo estos:`;
    } else {
      slots = [];
    }
  }
  if (!slots.length) {
    // Pidió un día/turno puntual sin disponibilidad: avisar sin romper.
    if (opts.desde || opts.turno) {
      return { state, messages: [`No tengo horarios para ese día/horario ${lugarLabel(state)}. ¿Querés que te muestre los más próximos?`], active: true };
    }
    // Sin horarios: ofrecer videollamada como salida (si no estábamos ya en video).
    if (state.modalidad !== 'video') {
      const video = await deps.videoOfficeName();
      if (video) {
        return loadSlots({ ...state, modalidad: 'video', oficina: video }, deps);
      }
    }
    return {
      state: { ...state, stage: 'ask_modality' },
      messages: [`Por ahora no tengo horarios libres ${lugarLabel(state)}. ¿Querés que probemos de otra forma?`],
      active: true,
    };
  }
  const offered: OfferedOption[] = slots.map((s, i) => ({ index: i + 1, label: SLOT_LABEL(s), value: s.start }));
  const meta: Record<string, { end: string; profileId?: string | null; oficina: string }> = {};
  for (const s of slots) meta[s.start] = { end: s.end, profileId: s.profileId ?? null, oficina: s.oficina ?? oficina };
  const nextState = { ...state, stage: 'await_slot' as const, offered, meta, desde: opts.desde ? opts.desde.toISOString() : state.desde };
  return {
    state: nextState,
    messages: [showSlotsMessage(nextState, offered, lead)],
    active: true,
  };
}

// Resuelto modalidad/zona → decide oficina y carga slots (o pide lo que falte).
async function afterModality(state: BookingState, deps: BookingDeps): Promise<BookingStep> {
  if (state.modalidad === 'video') {
    const video = await deps.videoOfficeName();
    if (!video) {
      return { state: { ...state, stage: 'ask_modality' }, messages: ['No tengo la videollamada disponible ahora. ¿Preferís presencial?'], active: true };
    }
    return loadSlots({ ...state, oficina: video }, deps);
  }
  // presencial
  if (!state.zona) {
    return { state: { ...state, stage: 'ask_zone' }, messages: ['¿De qué zona sos? Así te sugiero la oficina más cercana. 🙂'], active: true };
  }
  const sug = await deps.suggestOffice(state.zona);
  if (sug.oficina_sugerida) {
    return loadSlots({ ...state, oficina: sug.oficina_sugerida }, deps);
  }
  if (sug.necesita_aclaracion) {
    return { state: { ...state, stage: 'ask_zone' }, messages: [sug.pregunta_aclaracion || '¿En qué zona o localidad estás?'], active: true };
  }
  // fuera de cobertura → videollamada (avisando el motivo)
  return farToVideo(state, deps);
}

function confirmMessage(state: BookingState): string {
  const fecha = state.chosenStart ? fmt(state.chosenStart) : 'el horario elegido';
  return `Perfecto${state.nombre ? ', ' + state.nombre : ''}. Te agendo el ${fecha} ${lugarLabel(state)}. ¿Confirmo? (sí / no)`;
}

/** Inicia el flujo (lo llama el LLM vía tool start_booking). */
export async function startBooking(
  args: { modalidad?: 'presencial' | 'video'; zona?: string; nombre?: string },
  deps: BookingDeps,
): Promise<BookingStep> {
  const state: BookingState = {
    stage: 'ask_modality',
    modalidad: args.modalidad,
    zona: args.zona ?? null,
    nombre: args.nombre ? cleanName(args.nombre) : undefined,
  };
  if (!state.modalidad) {
    return { state, messages: ['¡Dale! ¿Preferís la consulta presencial o por videollamada?'], active: true };
  }
  return afterModality(state, deps);
}

/** Avanza el flujo con el siguiente mensaje del usuario. Determinístico. */
export async function advanceBooking(state: BookingState, text: string, deps: BookingDeps): Promise<BookingStep> {
  switch (state.stage) {
    case 'ask_modality': {
      const m = detectModalidad(text);
      if (!m) return { state, messages: ['¿Lo hacemos presencial o por videollamada?'], active: true };
      return afterModality({ ...state, modalidad: m }, deps);
    }

    case 'ask_zone': {
      const sug = await deps.suggestOffice(text);
      if (sug.oficina_sugerida) return loadSlots({ ...state, zona: text, oficina: sug.oficina_sugerida }, deps);
      if (sug.necesita_aclaracion) {
        return { state: { ...state, zona: text }, messages: [sug.pregunta_aclaracion || '¿En qué localidad estás?'], active: true };
      }
      return farToVideo({ ...state, zona: text }, deps);
    }

    case 'await_slot': {
      const req = parseSlotRequest(text);
      // Pidió un DÍA explícito distinto ("el martes", "mañana") → re-buscamos ese día,
      // sin elegir del día actual.
      if (req.desde) {
        return loadSlots({ ...state, offered: undefined, meta: undefined }, deps, { desde: req.desde, turno: req.turno });
      }
      const picked = resolveOption({ userText: text, offered: state.offered ?? [] });
      if (picked.matchedValue && picked.confianza >= 0.55) {
        const next = { ...state, chosenStart: picked.matchedValue, stage: state.nombre ? 'confirm' as const : 'ask_name' as const };
        if (next.nombre) return { state: next, messages: [confirmMessage(next)], active: true };
        return { state: next, messages: ['Genial. ¿A nombre de quién lo agendo?'], active: true };
      }
      // No eligió. ¿Cambió de modalidad?
      const m = detectModalidad(text);
      if (m && m !== state.modalidad) return afterModality({ ...state, modalidad: m, oficina: undefined, offered: undefined, meta: undefined }, deps);
      // ¿Pidió otro turno/horario ("de tarde", "más temprano", "otro")? → re-buscar,
      // manteniendo el día que ya venía mirando (state.desde) si lo hay.
      if (req.isRequest) {
        return loadSlots({ ...state, offered: undefined, meta: undefined }, deps, { turno: req.turno, desde: state.desde ? new Date(state.desde) : undefined });
      }
      return { state, messages: ['Decime cuál te sirve con el número (1, 2 o 3), o pedime otro día/horario. 🙂'], active: true };
    }

    case 'ask_name': {
      const nombre = cleanName(text);
      if (!nombre || nombre.length < 2) return { state, messages: ['¿Me decís tu nombre y apellido para agendarlo?'], active: true };
      const next = { ...state, nombre, stage: 'confirm' as const };
      return { state: next, messages: [confirmMessage(next)], active: true };
    }

    case 'confirm': {
      if (isAffirmative(text)) {
        const start = state.chosenStart!;
        const m = state.meta?.[start];
        try {
          const res = await deps.book({ nombre: state.nombre!, start, end: m?.end ?? start, oficina: m?.oficina ?? state.oficina!, profileId: m?.profileId ?? null });
          const fecha = fmt(start);
          const extra = res.video_link ? `\nEnlace: ${res.video_link}` : res.direccion ? `\nDirección: ${res.direccion}` : '';
          return {
            state: { ...state, stage: 'done' },
            messages: [`¡Listo${state.nombre ? ', ' + state.nombre : ''}! Te agendé el ${fecha} ${lugarLabel(state)}.${extra}\nUn abogado se va a contactar con vos. Cualquier cosa escribime. 🙌`],
            active: false,
          };
        } catch {
          // El slot se ocupó entre medio (TOCTOU): volver a ofrecer.
          const reload = await loadSlots({ ...state, chosenStart: undefined }, deps);
          return { state: reload.state, messages: ['Uy, ese horario se acaba de ocupar. ' + reload.messages[0]], active: true };
        }
      }
      if (isNegative(text)) {
        return { state: { ...state, stage: 'await_slot', chosenStart: undefined }, messages: ['Dale, elegí otro: ' + showSlotsMessage(state, state.offered ?? [])], active: true };
      }
      return { state, messages: ['¿Te lo confirmo? Respondé sí o no. 🙂'], active: true };
    }

    default:
      return { state: { ...state, stage: 'done' }, messages: [], active: false };
  }
}

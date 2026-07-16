// ─── BookingFlow ──────────────────────────────────────────────────────────────
// State machine DETERMINÍSTICO de agendado. El LLM solo reconoce la intención y
// llama start_booking; de ahí en más este reducer conduce los pasos (oficina única
// → slots → elección → nombre → confirmar → agendar) SIN depender del modelo. Así
// se elimina la fricción observada: inventar horarios, "te agendé" sin agendar,
// re-listar, mostrar varias oficinas juntas.
//
// Reducer puro (deps inyectadas, estado in/out): testeable sin Redis ni LLM.

import { resolveOption, type OfferedOption } from './OptionResolver';
import { validarTelefonoAR } from '../../../utils/phone-ar';
import { esPsid } from '../../../utils/psid';

const TZ = 'America/Argentina/Buenos_Aires';

export type BookingStage = 'ask_modality' | 'ask_zone' | 'ask_office' | 'await_slot' | 'ask_name' | 'ask_phone' | 'confirm' | 'done';

export interface BookingState {
  stage: BookingStage;
  modalidad?: 'presencial' | 'video';
  zona?: string | null;
  oficina?: string;
  oficinaSugerida?: string;                                    // sede que la zona sugiere (default si el cliente no nombra una en ask_office)
  sedeOptions?: OfferedOption[];                               // sedes+video ofrecidas en ask_office (value = nombre interno, o '__video__')
  offered?: OfferedOption[];                                   // slots mostrados (value = start ISO)
  meta?: Record<string, { end: string; profileId?: string | null; oficina: string }>;
  chosenStart?: string;
  nombre?: string;
  telefono?: string;                                          // teléfono real dado en el chat (FB/IG: el id de la red NO es teléfono)
  telefonoSugerido?: string;                                  // teléfono capturado por el extractor: se CONFIRMA antes de usar
  needsPhone?: boolean;                                       // canal sin número real (FB/IG) → pedirlo explícito
  desde?: string;                                             // ISO del día desde el que se buscó (para "de tarde" tras "el viernes")
  minHour?: number;                                           // hora AR mínima pedida por el cliente ("después de las 15:30" → 15.5); persiste en re-búsquedas
  askRetries?: number;                                        // intentos fallidos de parseo en await_slot → rota la plantilla (anti-repetición)
  rescheduleApptId?: string;                                  // si está seteado, al elegir slot se REPROGRAMA esta cita (no se agenda una nueva)
}

export interface BookingSlot { start: string; end: string; profileId?: string | null; oficina?: string }

export interface BookingDeps {
  suggestOffice: (text: string) => Promise<{ oficina_sugerida: string | null; necesita_aclaracion: boolean; pregunta_aclaracion?: string }>;
  videoOfficeName: () => Promise<string | null>;
  defaultOffice: () => Promise<string | null>; // sede presencial por defecto (fallback fuera de cobertura si no hay video)
  // Sedes presenciales del estudio con su etiqueta de zona (CABA/Quilmes/Haedo) y dirección.
  // nombreInterno = account_offices.nombre (NUNCA se muestra al cliente; solo zona+dirección).
  // zona: null si no se pudo derivar (entonces se muestra solo la dirección, jamás el nombre interno).
  presencialOffices: () => Promise<Array<{ nombreInterno: string; zona: string | null; direccion: string | null }>>;
  // opts.desde: buscar slots desde esa fecha (para "el martes"); opts.max: cantidad.
  freeSlots: (oficina: string, opts?: { desde?: Date; max?: number }) => Promise<BookingSlot[]>;
  book: (b: { nombre: string; start: string; end: string; oficina: string; profileId?: string | null; telefono?: string }) => Promise<{ direccion?: string | null; video_link?: string | null; modalidad?: string }>;
  // Reprograma una cita EXISTENTE con un slot REAL (nunca una fecha inventada por el LLM).
  reschedule?: (b: { apptId: string; start: string; end: string; oficina: string; profileId?: string | null }) => Promise<{ direccion?: string | null; video_link?: string | null; modalidad?: string }>;
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

// Detección DETERMINÍSTICA de intención de REPROGRAMAR una cita existente. Arranca
// el flujo de reprogramación (slots reales de la sede de la cita) sin depender de que
// el LLM llame reschedule_appointment con una fecha inventada.
const RESCHEDULE_WORDS = /\b(reprogramar|reprograma|reagendar|reagenda|cambiar (el|mi|la) (turno|cita|horario|hora)|mover (el|mi|la) (turno|cita)|correr (el|mi) turno|otro (dia|horario) para (mi|el) turno|cambiar la fecha)\b/;
// Cambio SIN nombrar el turno ("puede ser mejor el miércoles", "prefiero el jueves",
// "lo pasamos para el viernes"): exige palabra de cambio + referencia temporal JUNTAS
// para no falsear. El runtime igual verifica que exista una cita próxima; sin cita,
// cae al flujo normal. (Prod 2026-07-07: sin esto se arrancaba un booking nuevo y
// quedaban dos citas vivas.)
const CHANGE_HINT = /\b(mejor|puede ser|podria ser|prefiero|preferiria|me (viene|queda) mejor|(la|lo) pasamos|pasala|pasalo|pasar(la|lo)? para)\b/;
const TIME_HINT = /\b(lunes|martes|miercoles|jueves|viernes|sabado|domingo|pasado manana|manana|otro dia|otro horario|otra hora|mas tarde|mas temprano|(a la|de la|de) (tarde|manana)|a las \d{1,2}|\d{1,2}[:.]\d{2}|\d{3,4}\s*(hs|h)\b)\b/;
export function detectRescheduleIntent(text: string): boolean {
  const t = norm(text);
  return RESCHEDULE_WORDS.test(t) || (CHANGE_HINT.test(t) && TIME_HINT.test(t));
}

function detectModalidad(text: string): 'presencial' | 'video' | null {
  const t = norm(text);
  if (/\b(video|videollamada|llamada|virtual|por video|computadora|pantalla|online|telefono|telefonica)\b/.test(t)) return 'video';
  if (/\b(presencial|en persona|ir|me acerco|acercarme|oficina|personalmente|cara a cara)\b/.test(t)) return 'presencial';
  return null;
}

// ¿El cliente nombró EXPLÍCITAMENTE esta sede? Un token distintivo de la etiqueta
// (zona o calle) aparece en el texto. Excluye genéricos ("oficina") para no falsear.
// En ask_office NO usamos ordinal/posicional (la lista no está numerada) ni aceptaciones
// vagas: sólo un match de contenido cuenta como "eligió esta sede".
const SEDE_STOPWORDS = new Set(['oficina', 'oficinas', 'nuestra', 'edificio', 'cuadras', 'esquina', 'entre', 'casi']);
function textNamesSede(text: string, opt: OfferedOption): boolean {
  const t = norm(text);
  const tokens = norm(opt.label).split(/[^a-z0-9]+/).filter((w) => w.length >= 4 && !SEDE_STOPWORDS.has(w));
  return tokens.some((tok) => t.includes(tok));
}

function isAffirmative(text: string): boolean {
  return /\b(si|sip|dale|ok|oka|okey|confirmo|confirma|confirmado|listo|perfecto|de acuerdo|esta bien|asi es|correcto|va|buenisimo|barbaro|joya)\b/.test(norm(text));
}

function isNegative(text: string): boolean {
  return /\b(no|nop|otro|otra|cambiar|mejor otro|distinto|ninguno|ninguna)\b/.test(norm(text));
}

// Rechazo EXPLÍCITO del agendado ("no gracias", "mejor no", "dejalo"). En producción
// se agendó una cita contra un "No gracias" que ask_name tomó como nombre. `bareNo`:
// el "no" pelado solo cuenta como rechazo donde no admite otra lectura (ask_name);
// en ask_phone un "no" puede ser "no a ese número" y en await_slot "ninguno me sirve".
const DECLINE_RE = /\b(no,?\s+gracias|mejor\s+no|no\s+quiero|no\s+me\s+interesa|no\s+por\s+ahora|ya\s+no\s+(quiero|hace\s+falta)|dejal[oa]|dejemosl[oa]|olvidal[oa]|cancelar|cancelo|cancela(lo)?|en\s+otro\s+momento)\b/;
function isDecline(text: string, opts: { bareNo?: boolean } = {}): boolean {
  const t = norm(text);
  if (opts.bareNo && /^no+[.!\s]*$/.test(t)) return true;
  return DECLINE_RE.test(t);
}

// Cierre cordial sin agendar (libreto: usted + puerta abierta, sin insistir).
function declineStep(state: BookingState): BookingStep {
  return {
    state: { ...state, stage: 'done' },
    messages: ['Como guste, no hay problema. Si más adelante quiere coordinar la consulta, me escribe por acá.'],
    active: false,
  };
}

// Hora del slot en horario Argentina (UTC-3), para filtrar mañana/tarde.
function slotHourAR(iso: string): number {
  return (new Date(iso).getUTCHours() - 3 + 24) % 24;
}

// Hora DECIMAL AR del slot (15:30 → 15.5), para comparar contra minHour pedido.
function slotDecAR(iso: string): number {
  return slotHourAR(iso) + new Date(iso).getUTCMinutes() / 60;
}

// Hora decimal → "HH:MM" para el mensaje ("15.5" → "15:30").
function fmtHour(dec: number): string {
  const h = Math.floor(dec);
  const m = Math.round((dec - h) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

const DOW: Record<string, number> = { domingo: 0, lunes: 1, martes: 2, miercoles: 3, jueves: 4, viernes: 5, sabado: 6 };

/**
 * Parser DETERMINÍSTICO (sin IA) de un pedido de OTRO día/horario dentro del agendado:
 * "el martes", "mañana", "la semana que viene", "a la tarde", "más tarde", "otra fecha".
 * `now` se inyecta para testear. Devuelve si es un pedido de re-búsqueda + desde/turno.
 */
/**
 * Extrae la hora AR MÍNIMA pedida ("después de las 3 y media" → 15.5), como decimal.
 * Conservador: sólo devuelve algo si hay una señal clara de cota inferior; ante duda,
 * undefined (mejor no filtrar que filtrar mal). `t` ya viene normalizado (sin acentos).
 */
function extractMinHour(t: string): number | undefined {
  // "pasado el mediodía" / "después del mediodía" → 13. Tolera "medio dia" en dos
  // palabras y el typo "despus" (prod 2026-07-13: "despus del medio dia").
  if (/\b(pasad[oa]s?|despue?s del?)\s+(el\s+)?medio\s*dia\b/.test(t)) return 13;

  // "antes de las N" es un TECHO, no un piso: ignorar salvo negación ("no puedo antes
  // de las 4") o "recién". Sin esta guarda, "antes de las 15" invertía la restricción.
  if (/\bantes de\b/.test(t) && !/\b(no|recien)\b/.test(t)) return undefined;

  // Busca una cota inferior: "(después/a partir/no antes/recién/pasadas/desde/de) [las] HH[:MM] [y media/cuarto]".
  // Lookahead negativo: el número NO puede ser una duración/cantidad ("15 días", "5 hijos") — eso no es hora.
  const m = t.match(/(?:despues de(?:l)?|a partir de|no antes de|recien(?:\s+despues de)?|pasad[oa]s?|desde|de)\s+(?:las?\s+)?(\d{1,2})(?!\d)(?!\s*(?:dias?|anos?|anios?|meses|semanas?|cuadras|hijos|personas|minutos|km|kilometros|millones|mil))(?:[:.](\d{2}))?(?:\s*y\s+(media|cuarto))?/);
  if (!m) return undefined;
  let hour = Number(m[1]);
  let min = m[2] ? Number(m[2]) : 0;
  if (m[3] === 'media') min = 30;
  else if (m[3] === 'cuarto') min = 15;
  if (hour > 23 || min > 59) return undefined;

  // Contexto de tarde: número ≤7 junto a "tarde"/"pm"/"después" → asumimos PM (+12).
  // PERO si dice mañana explícita ("de la mañana"/"am"), NO sumamos 12 ("7 de la mañana" = 7).
  const tardeCtx = /\b(tarde|pm)\b/.test(t) || /\bdespues\b/.test(t);
  const amCtx = /\b(de|a|por)\s+la\s+manana\b/.test(t) || /\b(am|madrugada)\b/.test(t);
  if (hour < 8 && tardeCtx && !amCtx) hour += 12;

  const dec = hour + min / 60;
  if (dec < 0 || dec > 23.99) return undefined;
  return dec;
}

export function parseSlotRequest(text: string, now: Date = new Date()): { isRequest: boolean; desde?: Date; turno?: 'manana' | 'tarde'; minHour?: number } {
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

  const minHour = extractMinHour(t);

  // Es un pedido de re-búsqueda si hay día, turno, hora mínima, o un "otro/más tarde/no me sirve" explícito.
  const otherSignal = /\b(otro|otra|mas tarde|mas temprano|no me sirve|no tenes|no hay|ninguno|ninguna)\b/.test(t);
  return { isRequest: !!(desde || turno || otherSignal || minHour !== undefined), desde, turno, minHour };
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

// El LLM a veces pasa un nombre-relleno ("Cliente") en vez del real. No se acepta:
// se guardaron 15 citas con nombre "Cliente" en producción por esto.
const NAME_PLACEHOLDERS = new Set(['cliente', 'usuario', 'senor', 'senora', 'sr', 'sra', 'sin nombre', 'na', 'n a', 'test', 'desconocido']);
// PSID de FB/IG (todo dígitos, 11+): el LLM a veces lo pasa como "nombre" del contacto
// (prod 2026-07-16: citas a nombre de "25516497748025583"). Nunca es un nombre.
function isPlaceholderName(s: string): boolean { return NAME_PLACEHOLDERS.has(norm(s)) || esPsid(s); }

const SLOT_LABEL = (s: BookingSlot): string => fmt(s.start);

// Etiqueta de cara al CLIENTE: nunca exponemos el nombre interno de la agenda/
// profesional (las oficinas se llaman "DANIELA CANISSA", etc.). El cliente solo ve
// la modalidad.
function lugarLabel(state: BookingState): string {
  return state.modalidad === 'video' ? 'por videollamada' : 'de forma presencial';
}

function horaAR(iso: string): string {
  try { return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }); } catch { return iso; }
}
function diaAR(iso: string): string {
  try { return new Date(iso).toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: '2-digit', timeZone: TZ }); } catch { return ''; }
}
function turnoWord(h: number): string { return h < 12 ? 'de mañana' : h < 14 ? 'sobre el mediodía' : 'de tarde'; }
function turnoBucket(h: number): 0 | 1 | 2 { return h < 12 ? 0 : h < 14 ? 1 : 2; }

// Diversifica la oferta: 1 turno por franja (mañana / mediodía / tarde) si hay, así
// el cliente ve las opciones reales y no pide "a la tarde" cuando no hay. Completa
// hasta 3 con los más próximos y ordena cronológicamente.
function diversifyByTurno(raw: BookingSlot[]): BookingSlot[] {
  const buckets: BookingSlot[][] = [[], [], []];
  for (const s of raw) buckets[turnoBucket(slotHourAR(s.start))].push(s);
  const picked: BookingSlot[] = [];
  for (const b of buckets) if (b.length) picked.push(b[0]); // 1 por franja (el más temprano de cada una)
  if (picked.length < 3) {
    const chosen = new Set(picked.map((s) => s.start));
    for (const s of raw) { if (picked.length >= 3) break; if (!chosen.has(s.start)) picked.push(s); }
  }
  return picked.sort((a, b) => a.start.localeCompare(b.start)).slice(0, 3);
}

// Ofrece los horarios en LENGUAJE NATURAL (no "1, 2, 3"). El cliente elige diciendo
// el horario ("a las 10", "el del mediodía"); OptionResolver lo resuelve por hora.
function showSlotsMessage(state: BookingState, offered: OfferedOption[], lead?: string): string {
  const items = offered.map((o) => ({ turno: turnoWord(slotHourAR(o.value)), hora: horaAR(o.value), dia: diaAR(o.value) }));
  const dias = new Set(items.map((i) => i.dia));
  const multiDay = dias.size > 1;
  // SIEMPRE indicamos el día (si no, el cliente pregunta "¿qué día?").
  const frags = items.map((i) => (multiDay ? `el ${i.dia} ${i.turno} a las ${i.hora}` : `${i.turno} a las ${i.hora}`));
  const lista = frags.length === 1 ? frags[0] : `${frags.slice(0, -1).join(', ')} o ${frags[frags.length - 1]}`;
  const diaPrefix = !multiDay ? `Para el ${[...dias][0]}: ` : '';
  if (lead) return `${lead} ${diaPrefix}${lista}. ¿Cuál le queda más cómodo? Puede decirme el horario o el día.`;
  return `${diaPrefix}tengo disponible ${lugarLabel(state)} ${lista}. ¿Cuál le queda más cómodo? Puede decirme el horario o el día.`;
}

// Fuera de cobertura (otra provincia / lejos de toda sede): el libreto del estudio dice
// VIDEOLLAMADA. Ofrecemos video; solo si NO hay oficina de video caemos a una sede
// presencial por defecto (no tendría sentido mandar a alguien de Mendoza a CABA).
async function outOfCoverage(state: BookingState, deps: BookingDeps): Promise<BookingStep> {
  const video = await deps.videoOfficeName();
  if (video) {
    const step = await loadSlots({ ...state, modalidad: 'video', oficina: video }, deps);
    if (step.messages.length && step.state.stage === 'await_slot') {
      step.messages[0] = `En esa zona no tenemos sede, así que lo hacemos por videollamada. ${step.messages[0]}`;
    }
    return step;
  }
  // Sin oficina de video → recién ahí, una sede presencial por defecto.
  const sede = await deps.defaultOffice();
  if (sede) {
    const step = await loadSlots({ ...state, modalidad: 'presencial', oficina: sede }, deps);
    if (step.messages.length && step.state.stage === 'await_slot') {
      step.messages[0] = `En esa zona no tenemos sede; le ofrezco una de nuestras oficinas. ${step.messages[0]}`;
    }
    return step;
  }
  return { state: { ...state, stage: 'ask_modality' }, messages: ['Esa zona nos queda lejos de nuestras oficinas. ¿La hacemos por videollamada?'], active: true };
}

// Carga slots de UNA oficina y arma el paso await_slot. Si no hay, ofrece alternativa.
// opts.desde: buscar desde otra fecha ("el martes"); opts.turno: filtrar mañana/tarde.
async function loadSlots(state: BookingState, deps: BookingDeps, opts: { desde?: Date; turno?: 'manana' | 'tarde'; minHour?: number } = {}): Promise<BookingStep> {
  const oficina = state.oficina!;
  // Hora mínima pedida (persiste entre re-búsquedas, igual que `desde`).
  const minHour = opts.minHour ?? state.minHour;
  // Con restricción de hora pedimos más slots (abarcan más días) para poder cumplirla.
  const rawAll = await deps.freeSlots(oficina, { desde: opts.desde, max: minHour !== undefined ? 60 : 30 });
  // Cumplen la hora mínima pedida (comparación en hora decimal AR: 15:30 → 15.5).
  const raw = minHour !== undefined ? rawAll.filter((s) => slotDecAR(s.start) >= minHour) : rawAll;
  let slots = diversifyByTurno(raw); // por defecto: 1 por franja (mañana/mediodía/tarde)
  let lead: string | undefined;
  if (opts.turno) {
    const f = raw.filter((s) => (opts.turno === 'tarde' ? slotHourAR(s.start) >= 13 : slotHourAR(s.start) < 13));
    if (f.length) {
      slots = f.slice(0, 3);
    } else if (raw.length) {
      // No hay del turno pedido, pero sí hay otros ese día: los mostramos con aviso.
      slots = diversifyByTurno(raw);
      lead = `No tengo turnos a la ${opts.turno === 'tarde' ? 'tarde' : 'mañana'}${opts.desde ? ' ese día' : ''}, pero ${lugarLabel(state)} tengo estos:`;
    } else {
      slots = [];
    }
  }
  if (!slots.length) {
    // La restricción de hora vació todo, pero SÍ había horarios (antes de filtrar): avisar preciso.
    if (minHour !== undefined && rawAll.length) {
      const hh = fmtHour(minHour);
      const nextS = { ...state, minHour };
      if (opts.desde) {
        return { state: nextS, messages: [`No tengo horarios después de las ${hh} ese día ${lugarLabel(state)}. ¿Quiere que busque otro día?`], active: true };
      }
      return { state: nextS, messages: [`No tengo horarios después de las ${hh} en los próximos días ${lugarLabel(state)}. ¿Le sirve algún otro horario?`], active: true };
    }
    // Pidió un día/turno puntual sin disponibilidad: avisar sin romper.
    if (opts.desde || opts.turno) {
      return { state, messages: [`No tengo horarios para ese día/horario ${lugarLabel(state)}. ¿Quiere que le muestre los más próximos?`], active: true };
    }
    // Sin horarios presenciales: caer a videollamada, PERO avisando (nunca en silencio).
    if (state.modalidad !== 'video') {
      const video = await deps.videoOfficeName();
      if (video) {
        const step = await loadSlots({ ...state, modalidad: 'video', oficina: video }, deps);
        if (step.messages.length && step.state.stage === 'await_slot') {
          step.messages[0] = `Por el momento no tengo horarios presenciales en esa sede. Si le sirve, le paso opciones por videollamada: ${step.messages[0]}`;
        }
        return step;
      }
    }
    return {
      state: { ...state, stage: 'ask_modality' },
      messages: [`Por ahora no tengo horarios libres ${lugarLabel(state)}. ¿Quiere que lo veamos de otra forma?`],
      active: true,
    };
  }
  const offered: OfferedOption[] = slots.map((s, i) => ({ index: i + 1, label: SLOT_LABEL(s), value: s.start }));
  const meta: Record<string, { end: string; profileId?: string | null; oficina: string }> = {};
  for (const s of slots) meta[s.start] = { end: s.end, profileId: s.profileId ?? null, oficina: s.oficina ?? oficina };
  const nextState = { ...state, stage: 'await_slot' as const, offered, meta, desde: opts.desde ? opts.desde.toISOString() : state.desde, minHour };
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
      return { state: { ...state, stage: 'ask_modality' }, messages: ['No tengo la videollamada disponible ahora. ¿Prefiere presencial?'], active: true };
    }
    return loadSlots({ ...state, oficina: video }, deps);
  }
  // presencial: si el cliente YA eligió una sede (ask_office), no re-preguntar zona → cargar slots.
  if (state.oficina) return loadSlots(state, deps);
  if (!state.zona) {
    return { state: { ...state, stage: 'ask_zone' }, messages: ['¿En qué localidad o zona vive?'], active: true };
  }
  return offerModalityByZone(state, deps);
}

// Libreto: dada la ZONA, evaluar cobertura. En cobertura → OFRECER LAS 3 SEDES con
// dirección + videollamada (presencial es la prioridad del estudio, se ofrece primero).
// Fuera de cobertura → videollamada directa. El cliente NUNCA ve el nombre interno de
// la agenda (solo la zona + la dirección).
async function offerModalityByZone(state: BookingState, deps: BookingDeps): Promise<BookingStep> {
  const sug = await deps.suggestOffice(state.zona!);
  // Zona ambigua (varias localidades con mismo nombre, etc.) → repreguntar.
  if (sug.necesita_aclaracion && !sug.oficina_sugerida) {
    return { state: { ...state, stage: 'ask_zone' }, messages: [sug.pregunta_aclaracion || '¿En qué localidad o barrio vive?'], active: true };
  }
  // Fuera de cobertura (otra provincia / lejos de toda sede) → videollamada (libreto).
  if (!sug.oficina_sugerida) return outOfCoverage(state, deps);
  // EN COBERTURA → ofrecer las 3 sedes con dirección + videollamada, que elija.
  const sedes = await deps.presencialOffices();
  // Sin sedes cargadas → fallback a la sede sugerida (no dejamos al cliente sin oferta).
  if (!sedes.length) return loadSlots({ ...state, modalidad: 'presencial', oficina: sug.oficina_sugerida }, deps);
  // Etiqueta de cara al cliente: zona + dirección. Si no hay zona, SOLO la dirección
  // (o "nuestra oficina"); el nombre interno de la agenda JAMÁS se muestra.
  const sedeEtiqueta = (s: { zona: string | null; direccion: string | null }): string =>
    s.zona && s.direccion ? `${s.zona} — ${s.direccion}` : s.zona || s.direccion || 'nuestra oficina';
  const sedeFrase = (s: { zona: string | null; direccion: string | null }): string =>
    s.zona && s.direccion ? `en ${s.zona}, ${s.direccion}` : s.zona ? `en ${s.zona}` : s.direccion ? `en ${s.direccion}` : 'en nuestra oficina';
  const opts: OfferedOption[] = sedes.map((s, i) => ({ index: i + 1, label: sedeEtiqueta(s), value: s.nombreInterno }));
  opts.push({ index: sedes.length + 1, label: 'videollamada', value: '__video__' });
  const lista = sedes.map(sedeFrase).join('; ');
  const msg = `Tenemos oficinas ${lista}. También puede ser por videollamada, si le queda más cómodo. ¿Cómo prefiere atenderse?`;
  // Persistimos la sede sugerida por la zona: es el DEFAULT si el cliente no nombra
  // una sede puntual (evita agendar en la ciudad equivocada o loopear en ask_office).
  return { state: { ...state, stage: 'ask_office', sedeOptions: opts, oficinaSugerida: sug.oficina_sugerida }, messages: [msg], active: true };
}

// Agenda DIRECTO (sin "¿confirmo? sí/no"): el libreto del estudio prohíbe pedir
// confirmación explícita; se da la cita por confirmada con naturalidad.
async function bookNow(state: BookingState, deps: BookingDeps): Promise<BookingStep> {
  const start = state.chosenStart!;
  const m = state.meta?.[start];
  const end = m?.end ?? start;
  const oficina = m?.oficina ?? state.oficina!;
  const profileId = m?.profileId ?? null;
  const nombreSuffix = state.nombre ? ', ' + state.nombre : '';
  try {
    // Reprogramación: cita EXISTENTE + slot REAL (nunca la fecha que inventa el LLM).
    if (state.rescheduleApptId && deps.reschedule) {
      const res = await deps.reschedule({ apptId: state.rescheduleApptId, start, end, oficina, profileId });
      const extra = res.video_link ? `\nEnlace: ${res.video_link}` : res.direccion ? `\nDirección: ${res.direccion}` : '';
      return {
        state: { ...state, stage: 'done' },
        messages: [`Listo${nombreSuffix}. Su consulta quedó reprogramada para el ${fmt(start)} ${lugarLabel(state)}.${extra}\nCualquier cosa que necesite, estoy a disposición.`],
        active: false,
      };
    }
    const res = await deps.book({ nombre: state.nombre!, start, end, oficina, profileId, telefono: state.telefono });
    const extra = res.video_link ? `\nEnlace: ${res.video_link}` : res.direccion ? `\nDirección: ${res.direccion}` : '';
    return {
      state: { ...state, stage: 'done' },
      messages: [`Perfecto${nombreSuffix}. Queda agendado para el ${fmt(start)} ${lugarLabel(state)}.${extra}\nCualquier cosa que necesite, estoy a disposición.`],
      active: false,
    };
  } catch {
    // El slot se ocupó entre medio (TOCTOU): volver a ofrecer.
    const reload = await loadSlots({ ...state, chosenStart: undefined }, deps);
    return { state: reload.state, messages: ['Ese horario se acaba de ocupar recién. ' + reload.messages[0]], active: true };
  }
}

// Tras resolver el nombre: si el canal NO trae número real (FB/IG → needsPhone),
// pedir el teléfono; si ya lo tenemos (WhatsApp), agendar DIRECTO.
function afterName(state: BookingState, deps: BookingDeps): Promise<BookingStep> {
  if (state.needsPhone && !state.telefono) {
    // Teléfono capturado por el extractor → CONFIRMAR, no pedir de cero (spec P2d).
    if (state.telefonoSugerido) {
      return Promise.resolve({
        state: { ...state, stage: 'ask_phone' as const },
        messages: [`¿Lo contactamos al ${state.telefonoSugerido}? Si prefiere otro número, escríbamelo con código de área.`],
        active: true,
      });
    }
    return Promise.resolve({
      state: { ...state, stage: 'ask_phone' as const },
      messages: ['¿A qué número de teléfono lo contactamos? Con código de área, por favor.'],
      active: true,
    });
  }
  return bookNow(state, deps);
}

/** Inicia el flujo (lo llama el LLM vía tool start_booking). */
export async function startBooking(
  args: { modalidad?: 'presencial' | 'video'; zona?: string; nombre?: string; telefono?: string; telefonoSugerido?: string; needsPhone?: boolean },
  deps: BookingDeps,
): Promise<BookingStep> {
  // Limpiar PRIMERO y validar el resultado: "Sr."/"Sra." normalizan a "sr"/"sra"
  // recién tras cleanName (norm() no borra el punto), así no se cuelan como nombre.
  const nombreLimpio = args.nombre ? cleanName(args.nombre) : '';
  const state: BookingState = {
    stage: 'ask_modality',
    modalidad: args.modalidad,
    zona: args.zona ?? null,
    nombre: nombreLimpio && !isPlaceholderName(nombreLimpio) ? nombreLimpio : undefined,
    telefono: args.telefono?.trim() || undefined,
    telefonoSugerido: args.telefonoSugerido?.trim() || undefined,
    needsPhone: !!args.needsPhone,
  };
  // Si el cliente YA pidió videollamada explícita → respetar (no forzar presencial).
  if (state.modalidad === 'video') return afterModality(state, deps);
  // Si NO, arrancar por la ZONA (libreto: zona → cobertura → sedes). NO preguntar
  // "¿presencial o video?" neutral: eso desviaba a video a clientes de zona de cobertura.
  if (!state.zona) return { state: { ...state, stage: 'ask_zone' }, messages: ['¿En qué localidad o zona vive?'], active: true };
  return offerModalityByZone(state, deps);
}

/**
 * Inicia la REPROGRAMACIÓN de una cita existente. Reusa el MISMO motor de slots
 * reales del agendado: nunca se toma una fecha que venga del LLM. `rescheduleApptId`
 * viaja en el state; al elegir un slot, bookNow reprograma (no agenda una cita nueva).
 * Con oficina+modalidad de la cita → ofrece slots de esa sede directo. Sin ellas →
 * cae al flujo normal (zona → sedes) preservando rescheduleApptId.
 */
export async function startReschedule(
  args: { apptId: string; modalidad?: 'presencial' | 'video'; oficina?: string; needsPhone?: boolean; nombre?: string; telefono?: string },
  deps: BookingDeps,
  initialText?: string,
): Promise<BookingStep> {
  const nombreLimpio = args.nombre ? cleanName(args.nombre) : '';
  const state: BookingState = {
    stage: 'await_slot',
    rescheduleApptId: args.apptId,
    modalidad: args.modalidad,
    oficina: args.oficina,
    nombre: nombreLimpio && !isPlaceholderName(nombreLimpio) ? nombreLimpio : undefined,
    telefono: args.telefono?.trim() || undefined,
    needsPhone: !!args.needsPhone,
  };
  // Sin oficina/modalidad conocidas → arrancar como booking normal (zona → sedes),
  // preservando rescheduleApptId para que al elegir slot REPROGRAME (no agende nuevo).
  if (!state.oficina || !state.modalidad) {
    if (state.modalidad === 'video') return afterModality(state, deps);
    return { state: { ...state, stage: 'ask_zone' }, messages: ['Con gusto reprogramamos su turno. ¿En qué localidad o zona vive?'], active: true };
  }
  // Con oficina+modalidad de la cita existente → ofrecer slots reales de esa sede.
  // Si el texto inicial trae día/hora ("el jueves después de las 15:30"), pre-filtrar.
  const req = initialText ? parseSlotRequest(initialText) : { isRequest: false as const };
  return loadSlots(state, deps, { desde: req.desde, turno: req.turno, minHour: req.minHour });
}

/** Avanza el flujo con el siguiente mensaje del usuario. Determinístico. */
export async function advanceBooking(state: BookingState, text: string, deps: BookingDeps): Promise<BookingStep> {
  switch (state.stage) {
    case 'ask_modality': {
      const m = detectModalidad(text);
      if (!m) return { state, messages: ['¿La prefiere presencial o por videollamada?'], active: true };
      return afterModality({ ...state, modalidad: m }, deps);
    }

    case 'ask_zone': {
      // Cambió de idea y pidió video explícito → respetarlo (no tratarlo como "zona").
      if (detectModalidad(text) === 'video') return afterModality({ ...state, modalidad: 'video' }, deps);
      // Zona conocida → evaluar cobertura y ofrecer las 3 sedes (o video si está fuera).
      return offerModalityByZone({ ...state, zona: text }, deps);
    }

    case 'ask_office': {
      // 1) Video explícito ("mejor por videollamada").
      if (detectModalidad(text) === 'video') return afterModality({ ...state, modalidad: 'video', oficina: undefined }, deps);
      // 2) ¿Nombró una sede puntual? (token de zona/dirección en el texto). La lista NO
      //    está numerada: no resolvemos por ordinal/hora ni por aceptaciones vagas
      //    ("cualquiera", "la más cercana") — eso caería siempre en la 1ª (ciudad equivocada).
      const sedeOpts = (state.sedeOptions ?? []).filter((o) => o.value !== '__video__');
      const named = sedeOpts.find((o) => textNamesSede(text, o));
      if (named) return loadSlots({ ...state, modalidad: 'presencial', oficina: named.value }, deps);
      // 3) No nombró sede ni video (vago, número suelto, "no sé") → sede SUGERIDA por la
      //    zona (default determinístico: sin loop y en la ciudad correcta).
      if (state.oficinaSugerida) return loadSlots({ ...state, modalidad: 'presencial', oficina: state.oficinaSugerida }, deps);
      // 4) Sin sugerida → repreguntar (edge: sólo si no vino de offerModalityByZone).
      const zonasTxt = sedeOpts.length ? sedeOpts.map((o) => o.label.split(' — ')[0]).join(', ') : 'nuestras oficinas';
      return { state, messages: [`¿Prefiere alguna de nuestras oficinas (${zonasTxt}) o la videollamada?`], active: true };
    }

    case 'await_slot': {
      // Elegir una opción YA ofrecida gana sobre todo (Task 2: resolveOption robusto).
      const picked = resolveOption({ userText: text, offered: state.offered ?? [] });
      if (picked.matchedValue && picked.confianza >= 0.55) {
        const withSlot = { ...state, chosenStart: picked.matchedValue, askRetries: 0 };
        // Reprogramación: la cita ya existe (nombre/teléfono ya cargados) → reprogramar directo.
        if (withSlot.rescheduleApptId) return bookNow(withSlot, deps);
        if (withSlot.nombre) return afterName(withSlot, deps);
        return { state: { ...withSlot, stage: 'ask_name' as const }, messages: ['Perfecto. ¿A nombre de quién agendo la consulta?'], active: true };
      }
      const req = parseSlotRequest(text);
      // Un TURNO explícito ("a la mañana") reemplaza la cota vieja; un cambio de día la conserva.
      const keepMin = req.turno ? undefined : state.minHour;
      const effMin = req.minHour ?? keepMin;
      // Pidió un DÍA explícito distinto ("el martes", "mañana") → re-buscamos ese día.
      if (req.desde) {
        return loadSlots({ ...state, minHour: effMin, offered: undefined, meta: undefined, askRetries: 0 }, deps, { desde: req.desde, turno: req.turno, minHour: effMin });
      }
      // ¿Cambió de modalidad?
      const m = detectModalidad(text);
      if (m && m !== state.modalidad) return afterModality({ ...state, modalidad: m, oficina: undefined, offered: undefined, meta: undefined, askRetries: 0 }, deps);
      // ¿Pidió otro turno/horario ("de tarde", "más temprano", "otro")? → re-buscar,
      // manteniendo el día que ya venía mirando (state.desde) si lo hay.
      if (req.isRequest) {
        return loadSlots({ ...state, minHour: effMin, offered: undefined, meta: undefined, askRetries: 0 }, deps, { turno: req.turno, desde: state.desde ? new Date(state.desde) : undefined, minHour: effMin });
      }
      // Rechazo explícito sin otra señal accionable (ya se descartó slot/día/modalidad)
      // → cerrar SIN agendar. Nunca insistir contra un "no gracias".
      if (isDecline(text)) return declineStep(state);
      // No entendió: rotar la plantilla (en producción 22 convos loopearon con el
      // mismo "Decime qué horario preferís" repetido).
      const retries = (state.askRetries ?? 0) + 1;
      const fallbacks = [
        'Disculpe, no le entendí el horario. Puede decirme la hora o el día de la opción que le quede mejor.',
        'Le repito las opciones: ' + showSlotsMessage(state, state.offered ?? []),
        'Si ninguno de esos horarios le sirve, dígame qué día le queda cómodo y le busco otros.',
      ];
      return { state: { ...state, askRetries: retries }, messages: [fallbacks[Math.min(retries - 1, 2)]], active: true };
    }

    case 'ask_name': {
      // "No gracias"/"no" acá es rechazo del agendado, NO un nombre (en prod se
      // creó una cita a nombre de "No gracias").
      if (isDecline(text, { bareNo: true })) return declineStep(state);
      const nombre = cleanName(text);
      if (!nombre || nombre.length < 2 || isPlaceholderName(nombre)) return { state, messages: ['¿Me dice su nombre para agendarlo?'], active: true };
      return afterName({ ...state, nombre }, deps);
    }

    case 'ask_phone': {
      // Rechazo explícito → cerrar sin agendar ("no" pelado NO: puede ser "no a ese número").
      if (isDecline(text)) return declineStep(state);
      // Confirmación del teléfono sugerido por el extractor: "sí/dale" → usarlo.
      // Si además trae un número ("sí, mejor al 011..."), gana el número nuevo (cae al parseo).
      if (state.telefonoSugerido && isAffirmative(text) && !/\d{6,}/.test(text.replace(/[\s.-]/g, ''))) {
        return bookNow({ ...state, telefono: state.telefonoSugerido }, deps);
      }
      // FB/IG: "este mismo"/"desde este" NO es un teléfono (es la red). Pedir número real.
      if (state.needsPhone && /\b(este|el mismo|este mismo|desde este)\b/.test(norm(text))) {
        return { state, messages: ['Le escribo por esta red, así que necesito un número de teléfono para contactarlo. ¿Me lo pasa con código de área?'], active: true };
      }
      const v = validarTelefonoAR(text);
      if (!v.valido || !v.normalizado) {
        return { state, messages: ['Me parece que ese número está incompleto. ¿Me lo puede pasar de nuevo, con código de área?'], active: true };
      }
      return bookNow({ ...state, telefono: v.normalizado }, deps);
    }

    // Legado: estados que ya estaban en 'confirm' en Redis (el flujo nuevo agenda directo).
    case 'confirm': {
      if (isAffirmative(text)) return bookNow(state, deps);
      if (isNegative(text)) {
        return { state: { ...state, stage: 'await_slot', chosenStart: undefined }, messages: ['Como no, elija otro: ' + showSlotsMessage(state, state.offered ?? [])], active: true };
      }
      return { state, messages: ['¿Le confirmo ese horario? Respondame sí o no, por favor.'], active: true };
    }

    default:
      return { state: { ...state, stage: 'done' }, messages: [], active: false };
  }
}

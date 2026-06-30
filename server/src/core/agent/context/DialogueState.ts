// ─── DialogueState ────────────────────────────────────────────────────────────
// Estado conversacional explícito + slot-filling DETERMINÍSTICO.
// Mata los loops del agente: el código decide qué falta y qué preguntar, NO el LLM.
// Funciones PURAS, 100% testeables sin IA, sin red, sin reloj interno.
// Los timestamps se INYECTAN (no se usa new Date() adentro).
//
// NO duplica los stages de BookingFlow (modalidad/zona/nombre/horario).
// La fase 'agendado' delega el slot-filling a BookingFlow.

// ─── Tipos ───────────────────────────────────────────────────────────────────

export type SlotEstado = 'pendiente' | 'lleno' | 'no_aplica';

export interface Slot {
  valor: string | number | null;
  estado: SlotEstado;
  pedido_count: number; // cuántas veces se preguntó (anti-loop)
}

export type DialogueFase = 'consulta' | 'calificacion' | 'agendado' | 'cerrada';
export type CierreMotivo = 'completada' | 'opt_out' | 'despedida' | 'frustracion_handoff';

export interface DialogueState {
  fase: DialogueFase;
  area: string | null;              // AreaKey
  slots: Record<string, Slot>;
  ultima_pregunta: { slot: string; at: string } | null;
  redirecciones_offtopic: number;   // tope antes de cerrar/derivar
  cerrada: boolean;
  cierre_motivo: CierreMotivo | null;
}

// ─── Constantes internas ─────────────────────────────────────────────────────

// Áreas de jubilación que exigen el slot 'edad' (mínimo DURO).
const JUBILACION_AREAS = new Set(['jubilacion', 'jubilacion_hombre', 'jubilacion_mujer']);

// ─── Funciones puras ─────────────────────────────────────────────────────────

/**
 * Estado inicial: fase 'consulta', sin área, sin slots.
 */
export function createDialogueState(): DialogueState {
  return {
    fase: 'consulta',
    area: null,
    slots: {},
    ultima_pregunta: null,
    redirecciones_offtopic: 0,
    cerrada: false,
    cierre_motivo: null,
  };
}

/**
 * Los slots que la fase/área EXIGE (duros).
 *
 * Decisiones de diseño:
 * - 'consulta'    → [] (no exige slots).
 * - 'calificacion': híbrido.
 *     jubilacion / jubilacion_hombre / jubilacion_mujer → ['edad'] (mínimo DURO).
 *     cualquier otra área → [] (flexible: datos se llenan si se dan, pero no bloquean).
 * - 'agendado'    → [] (delegado a BookingFlow; no duplicar sus stages).
 * - 'cerrada'     → [].
 */
export function requiredSlots(state: DialogueState, area: string | null): string[] {
  if (state.fase === 'calificacion' && area !== null && JUBILACION_AREAS.has(area)) {
    return ['edad'];
  }
  return [];
}

/**
 * Siembra en state.slots los requiredSlots que falten, como
 * { valor: null, estado: 'pendiente', pedido_count: 0 }.
 * No pisa slots ya existentes. Devuelve nuevo estado (inmutable).
 */
export function ensureRequiredSlots(state: DialogueState, area: string | null): DialogueState {
  const required = requiredSlots(state, area);
  if (required.length === 0) return state;

  const newSlots = { ...state.slots };
  let changed = false;

  for (const slot of required) {
    if (!(slot in newSlots)) {
      newSlots[slot] = { valor: null, estado: 'pendiente', pedido_count: 0 };
      changed = true;
    }
  }

  if (!changed) return state;
  return { ...state, slots: newSlots };
}

/**
 * Por cada dato detectado: si el valor es no-vacío (no null/undefined/''), setea
 * ese slot a { valor, estado:'lleno', pedido_count: previo?.pedido_count ?? 0 }.
 * - Nunca pisa un slot existente con un valor vacío.
 * - Nunca borra slots.
 * - Acepta slots no sembrados (datos flexibles) → los agrega como 'lleno'.
 * Inmutable.
 */
export function mergeSlots(
  state: DialogueState,
  slots_detectados: Record<string, string | number>,
): DialogueState {
  const newSlots = { ...state.slots };
  let changed = false;

  for (const [key, valor] of Object.entries(slots_detectados)) {
    // Ignorar valores vacíos: null, undefined, string vacío.
    if (valor === null || valor === undefined || valor === '') continue;

    const existing = newSlots[key];
    newSlots[key] = {
      valor,
      estado: 'lleno',
      pedido_count: existing?.pedido_count ?? 0,
    };
    changed = true;
  }

  if (!changed) return state;
  return { ...state, slots: newSlots };
}

/**
 * El PRIMER slot con estado 'pendiente' en orden de inserción de state.slots.
 * Si no hay pendientes → null (no falta nada → se puede avanzar a la tool / fase siguiente).
 * Esta es la decisión determinística de qué preguntar.
 */
export function nextPendingSlot(state: DialogueState): string | null {
  for (const [key, slot] of Object.entries(state.slots)) {
    if (slot.estado === 'pendiente') return key;
  }
  return null;
}

/**
 * Incrementa pedido_count del slot y setea ultima_pregunta = { slot, at: now }.
 * Si el slot no existe, lo crea pendiente con count 1.
 * `now` se INYECTA como string ISO para testear — NO usa new Date() adentro.
 * Inmutable.
 */
export function markAsked(state: DialogueState, slot: string, now: string): DialogueState {
  const existing = state.slots[slot];
  const updatedSlot: Slot = existing
    ? { ...existing, pedido_count: existing.pedido_count + 1 }
    : { valor: null, estado: 'pendiente', pedido_count: 1 };

  return {
    ...state,
    slots: { ...state.slots, [slot]: updatedSlot },
    ultima_pregunta: { slot, at: now },
  };
}

/**
 * true si pedido_count >= 3.
 * Anti-loop duro: el controller (otra fase) usará esto para, en vez de re-preguntar
 * lo mismo por 4ta vez, derivar a humano.
 * DialogueState solo DETECTA; no actúa.
 */
export function isSlotStuck(state: DialogueState, slot: string): boolean {
  const s = state.slots[slot];
  return s !== undefined && s.pedido_count >= 3;
}

/**
 * Si nextPendingSlot devuelve un slot y ese slot está stuck (pedido_count >= 3),
 * devolverlo; si no, null.
 * Helper para que el controller decida derivar a humano.
 */
export function stuckSlot(state: DialogueState): string | null {
  const next = nextPendingSlot(state);
  if (next === null) return null;
  return isSlotStuck(state, next) ? next : null;
}

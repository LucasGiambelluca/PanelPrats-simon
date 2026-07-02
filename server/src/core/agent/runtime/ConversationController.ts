// ─── ConversationController (Fase 4a) ────────────────────────────────────────
// Orquestador DETERMINÍSTICO que corre antes del tool-loop del LLM.
// El código decide el flujo; el LLM (vía redactar) solo redacta una frase/pregunta.
// NUNCA toca AgentRuntime — el wiring lo hace la Fase 4b.

import type { IntentResult, IntentContext } from '../context/IntentClassifier';
import {
  type DialogueState,
  type CierreMotivo,
  createDialogueState,
  ensureRequiredSlots,
  mergeSlots,
  nextPendingSlot,
  markAsked,
  stuckSlot,
} from '../context/DialogueState';
import { norm } from '../context/normalize';

// Despedida/acuse PURO: todos los tokens pertenecen al vocabulario de cierre.
// Emojis y signos los elimina norm(). Texto vacío tras norm (solo emojis) cuenta como ack.
const ACK_WORDS = new Set([
  'gracias', 'muchas', 'mil', 'ok', 'okey', 'oka', 'dale', 'listo', 'genial', 'perfecto',
  'barbaro', 'buenisimo', 'excelente', 'igualmente', 'igual', 'de', 'nada', 'no', 'hasta',
  'luego', 'chau', 'adios', 'buenas', 'buenos', 'tardes', 'noches', 'nos',
  'vemos', 'saludos', 'este', 'bien', 'muy', 'amable', 'si', 'bueno', 'besos', 'abrazo',
]);
export function isBareAck(text: string): boolean {
  if (/[?¿]/.test(text)) return false; // una pregunta nunca es acuse
  const t = norm(text);
  if (!t) return (text || '').trim().length > 0; // solo emojis/signos → ack
  const words = t.split(' ');
  return words.length <= 6 && words.every((w) => ACK_WORDS.has(w));
}

// ─── Contrato de dependencias (todas inyectadas / mockeables) ─────────────────

export interface ControllerDeps {
  classify: (text: string, ctx: IntentContext) => Promise<IntentResult>;
  // Historial reciente (ambas direcciones) para darle CONTEXTO al clasificador: sin
  // esto, respuestas cortas ("Argentino", "a la tarde") se confunden con off_topic.
  history?: (accountId: string, phone: string) => Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  loadState: (accountId: string, phone: string) => Promise<DialogueState | null>;
  saveState: (accountId: string, phone: string, state: DialogueState) => Promise<void>;
  setOptOut: (accountId: string, phone: string) => Promise<void>;
  closeConversation: (
    accountId: string,
    phone: string,
    motivo: CierreMotivo,
  ) => Promise<void>;
  handoff: (
    accountId: string,
    phone: string,
    payload: { motivo: string; resumen_caso: string },
  ) => Promise<void>;
  redactar: (objetivo: string, ctx: { area?: string | null; accountId?: string }) => Promise<string>;
  detectArea: (text: string) => string | null;
  now: () => string; // ISO inyectable (no usa new Date() adentro)
  offtopicTope?: number; // default 2
}

// ─── Tipo de salida ───────────────────────────────────────────────────────────

export type ControllerOutcome =
  /** Turno resuelto determinísticamente — NO correr el tool-loop */
  | { kind: 'resolved'; messages: string[]; state: DialogueState }
  /** Delegar al tool-loop (set_qualification / start_booking / FAQ) */
  | { kind: 'advance'; state: DialogueState };

// ─── Clase principal ──────────────────────────────────────────────────────────

export class ConversationController {
  constructor(private deps: ControllerDeps) {}

  async handleTurn(
    accountId: string,
    phone: string,
    text: string,
  ): Promise<ControllerOutcome> {
    const {
      classify,
      history: loadHistory,
      loadState,
      saveState,
      setOptOut,
      closeConversation,
      handoff,
      redactar,
      detectArea,
      now,
      offtopicTope,
    } = this.deps;

    // ── Cargar estado (o crear uno nuevo) ──────────────────────────────────────
    const loaded = await loadState(accountId, phone);
    const state: DialogueState = loaded ?? createDialogueState();

    // ── 0. Conversación CERRADA ────────────────────────────────────────────────
    // Despedida/acuse sobre una conversación ya cerrada → SILENCIO (ni se clasifica:
    // cero llamadas IA). Contenido real → se reabre y sigue el flujo normal.
    let state2: DialogueState = state;
    if (state.cerrada) {
      // Handoff: una persona del estudio es dueña de esa conversación — el bot NO se
      // reengancha ni siquiera con contenido real. (Backstop: el estado HANDOVER
      // upstream ya debería silenciar al bot antes de llegar acá.)
      if (state.cierre_motivo === 'frustracion_handoff') {
        return { kind: 'resolved', messages: [], state };
      }
      if (isBareAck(text)) {
        return { kind: 'resolved', messages: [], state };
      }
      state2 = { ...state, cerrada: false, cierre_motivo: null, fase: 'consulta', redirecciones_offtopic: 0 };
    }

    // ── Detectar área + clasificar intención (con historial como contexto) ─────
    const area = detectArea(text) ?? state2.area;
    const hist = loadHistory ? await loadHistory(accountId, phone).catch(() => []) : [];
    const intent = await classify(text, { dialogueState: state2, area, history: hist });

    // ── Helper: persistir SIEMPRE y devolver resolved ──────────────────────────
    const finish = async (
      s: DialogueState,
      msgs: string[],
    ): Promise<ControllerOutcome> => {
      await saveState(accountId, phone, s);
      return { kind: 'resolved', messages: msgs, state: s };
    };

    // ── 1. Opt-out ─────────────────────────────────────────────────────────────
    if (intent.intent === 'opt_out') {
      await setOptOut(accountId, phone);
      const s: DialogueState = {
        ...state2,
        cerrada: true,
        cierre_motivo: 'opt_out',
        fase: 'cerrada',
      };
      await closeConversation(accountId, phone, 'opt_out');
      return finish(s, [
        'Listo, no le vamos a escribir más. Si en algún momento nos necesita, acá estamos.',
      ]);
    }

    // ── 2. Frustración alta (ANTES de despedida) ───────────────────────────────
    if (intent.nivel_frustracion >= 3) {
      await handoff(accountId, phone, {
        motivo: 'frustracion',
        resumen_caso: `Cliente frustrado (nivel ${intent.nivel_frustracion}). Último: "${text.slice(0, 200)}"`,
      });
      const s: DialogueState = {
        ...state2,
        cerrada: true,
        cierre_motivo: 'frustracion_handoff',
        fase: 'cerrada',
      };
      await closeConversation(accountId, phone, 'frustracion_handoff');
      return finish(s, [
        'Lo paso con una persona del estudio para que lo ayude mejor. Aguarde un momento.',
      ]);
    }

    // ── 3. Cierre natural / despedida ──────────────────────────────────────────
    // Backstop anti-falso-positivo: un 'es_cierre' alucinado sobre un contacto FRESCO
    // (recién abre, sin interacción previa) NO debe cerrar la conversación. Para cerrar
    // exigimos despedida EXPLÍCITA (label del modelo) o que ya haya habido enganche
    // (fase avanzada, algún slot, o redirecciones previas).
    const tuvoEnganche =
      state2.fase !== 'consulta' ||
      Object.keys(state2.slots).length > 0 ||
      state2.redirecciones_offtopic > 0;
    const quiereCerrar = intent.intent === 'despedida' || (intent.es_cierre && tuvoEnganche);
    // NO cerrar a mitad de proceso: en calificación/agendado un "ok gracias" suele ser
    // acuse, no chau. Se trata como continuación (cae al slot-filling / tool-loop).
    const enProceso = state2.fase === 'calificacion' || state2.fase === 'agendado';
    if (quiereCerrar && !enProceso) {
      // Solo cerrar si no hay nada crítico a medio llenar
      if (nextPendingSlot(state2) === null) {
        const s: DialogueState = {
          ...state2,
          cerrada: true,
          cierre_motivo: 'despedida',
          fase: 'cerrada',
        };
        await closeConversation(accountId, phone, 'despedida');
        return finish(s, ['Gracias a usted. Cualquier cosa que necesite, nos escribe. Que esté bien.']);
      }
      // Hay slots pendientes → NO cerrar; continuar abajo (el código sigue preguntando)
    }

    // ── Transición de fase + sembrado de slots ─────────────────────────────────
    let s: DialogueState = { ...state2 };

    if (area && s.area !== area) {
      s = { ...s, area };
    }

    if (
      s.fase === 'consulta' &&
      area &&
      (intent.intent === 'agendar' || intent.intent === 'responder_dato')
    ) {
      s = { ...s, fase: 'calificacion' };
    }

    s = ensureRequiredSlots(s, area);

    // ── 4. Off-topic ───────────────────────────────────────────────────────────
    if (intent.intent === 'off_topic') {
      s = { ...s, redirecciones_offtopic: s.redirecciones_offtopic + 1 };

      if (s.redirecciones_offtopic > (offtopicTope ?? 2)) {
        s = { ...s, cerrada: true, cierre_motivo: 'despedida', fase: 'cerrada' };
        await closeConversation(accountId, phone, 'despedida');
        return finish(s, [
          'Por acá solo podemos ayudarlo con temas del estudio (jubilaciones, pensiones, laboral). Que esté bien.',
        ]);
      }

      const msg = await redactar(
        'Redirigí amablemente al tema del estudio (jubilaciones, pensiones, laboral / despido, ART, accidentes). Una sola frase, cordial.',
        { area, accountId },
      );
      return finish(s, [msg]);
    }

    // ── 5. Incorporar datos aportados ──────────────────────────────────────────
    s = mergeSlots(s, intent.slots_detectados);

    // ── 6. Anti-loop: slot atascado → derivar ──────────────────────────────────
    const stuck = stuckSlot(s);
    if (stuck !== null) {
      await handoff(accountId, phone, {
        motivo: `slot_atascado:${stuck}`,
        resumen_caso: `No se pudo obtener "${stuck}" tras 3 intentos.`,
      });
      s = { ...s, cerrada: true, cierre_motivo: 'frustracion_handoff', fase: 'cerrada' };
      await closeConversation(accountId, phone, 'frustracion_handoff');
      return finish(s, [
        'Para no hacerlo repetir, lo paso con una persona del estudio. Aguarde un momento.',
      ]);
    }

    // ── 7. Próximo slot pendiente → preguntar UNA sola cosa ───────────────────
    const slot = nextPendingSlot(s);
    if (slot !== null) {
      s = markAsked(s, slot, now());
      const msg = await redactar(
        `Pedí el dato "${slot}" de forma natural y breve, UNA sola pregunta, sin re-saludar.`,
        { area, accountId },
      );
      return finish(s, [msg]);
    }

    // ── 8. Nada pendiente → delegar al tool-loop ───────────────────────────────
    await saveState(accountId, phone, s);
    return { kind: 'advance', state: s };
  }
}

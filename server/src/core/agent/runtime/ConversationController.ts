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

// ─── Contrato de dependencias (todas inyectadas / mockeables) ─────────────────

export interface ControllerDeps {
  classify: (text: string, ctx: IntentContext) => Promise<IntentResult>;
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

    // ── Detectar área + clasificar intención ───────────────────────────────────
    const area = detectArea(text) ?? state.area;
    const intent = await classify(text, { dialogueState: state, area });

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
        ...state,
        cerrada: true,
        cierre_motivo: 'opt_out',
        fase: 'cerrada',
      };
      await closeConversation(accountId, phone, 'opt_out');
      return finish(s, [
        'Listo, no le vamos a escribir más. Si en algún momento nos necesita, acá estamos. 🙏',
      ]);
    }

    // ── 2. Frustración alta (ANTES de despedida) ───────────────────────────────
    if (intent.nivel_frustracion >= 3) {
      await handoff(accountId, phone, {
        motivo: 'frustracion',
        resumen_caso: `Cliente frustrado (nivel ${intent.nivel_frustracion}). Último: "${text.slice(0, 200)}"`,
      });
      const s: DialogueState = {
        ...state,
        cerrada: true,
        cierre_motivo: 'frustracion_handoff',
        fase: 'cerrada',
      };
      await closeConversation(accountId, phone, 'frustracion_handoff');
      return finish(s, [
        'Lo paso con una persona del estudio para que lo ayude mejor. Aguarde un momento. 🙌',
      ]);
    }

    // ── 3. Cierre natural / despedida ──────────────────────────────────────────
    if (intent.es_cierre || intent.intent === 'despedida') {
      // Solo cerrar si no hay nada crítico a medio llenar
      if (nextPendingSlot(state) === null) {
        const s: DialogueState = {
          ...state,
          cerrada: true,
          cierre_motivo: 'despedida',
          fase: 'cerrada',
        };
        await closeConversation(accountId, phone, 'despedida');
        return finish(s, ['¡Gracias! Cualquier cosa, nos escribe. Que esté bien. 🙌']);
      }
      // Hay slots pendientes → NO cerrar; continuar abajo (el código sigue preguntando)
    }

    // ── Transición de fase + sembrado de slots ─────────────────────────────────
    let s: DialogueState = { ...state };

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
          'Por acá solo podemos ayudarlo con temas del estudio (jubilaciones, pensiones, laboral). ¡Que esté bien! 🙌',
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
        'Para no hacerlo repetir, lo paso con una persona del estudio. Aguarde un momento. 🙌',
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

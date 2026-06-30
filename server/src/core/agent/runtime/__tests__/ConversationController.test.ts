// ─── ConversationController — tests unitarios (TDD, Fase 4a) ─────────────────
import { describe, it, expect, vi } from 'vitest';
import { ConversationController, type ControllerDeps } from '../ConversationController';
import { createDialogueState } from '../../context/DialogueState';
import type { IntentResult } from '../../context/IntentClassifier';

const FIXED_NOW = '2026-06-30T00:00:00.000Z';
const ACCOUNT = 'acc1';
const PHONE = '+5491100000001';

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeIntent(overrides: Partial<IntentResult> = {}): IntentResult {
  return {
    intent: 'otro',
    quiere_continuar: true,
    nivel_frustracion: 0,
    es_cierre: false,
    slots_detectados: {},
    confianza: 1,
    ...overrides,
  };
}

function makeDeps(
  intentResult: IntentResult,
  overrides: Partial<ControllerDeps> = {},
): ControllerDeps {
  return {
    classify: vi.fn().mockResolvedValue(intentResult),
    loadState: vi.fn().mockResolvedValue(null),
    saveState: vi.fn().mockResolvedValue(undefined),
    setOptOut: vi.fn().mockResolvedValue(undefined),
    closeConversation: vi.fn().mockResolvedValue(undefined),
    handoff: vi.fn().mockResolvedValue(undefined),
    redactar: vi.fn().mockResolvedValue('PREGUNTA'),
    detectArea: vi.fn().mockReturnValue(null),
    now: () => FIXED_NOW,
    ...overrides,
  };
}

// ─── tests ───────────────────────────────────────────────────────────────────

describe('ConversationController — opt_out', () => {
  it('llama setOptOut y closeConversation(opt_out); resolved con despedida; saveState con cerrada:true', async () => {
    const intent = makeIntent({ intent: 'opt_out', quiere_continuar: false, es_cierre: true });
    const deps = makeDeps(intent);
    const ctrl = new ConversationController(deps);

    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, 'no me escriban más');

    expect(deps.setOptOut).toHaveBeenCalledWith(ACCOUNT, PHONE);
    expect(deps.closeConversation).toHaveBeenCalledWith(ACCOUNT, PHONE, 'opt_out');
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.messages[0]).toContain('no le vamos a escribir más');
      expect(outcome.state.cerrada).toBe(true);
      expect(outcome.state.cierre_motivo).toBe('opt_out');
    }
    expect(deps.saveState).toHaveBeenCalledWith(
      ACCOUNT,
      PHONE,
      expect.objectContaining({ cerrada: true, cierre_motivo: 'opt_out' }),
    );
  });
});

describe('ConversationController — frustración nivel 3', () => {
  it('llama handoff y closeConversation(frustracion_handoff); resolved', async () => {
    const intent = makeIntent({ intent: 'frustracion', nivel_frustracion: 3 });
    const deps = makeDeps(intent);
    const ctrl = new ConversationController(deps);

    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, 'esto es un asco!');

    expect(deps.handoff).toHaveBeenCalledWith(
      ACCOUNT,
      PHONE,
      expect.objectContaining({ motivo: 'frustracion' }),
    );
    expect(deps.closeConversation).toHaveBeenCalledWith(ACCOUNT, PHONE, 'frustracion_handoff');
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.state.cerrada).toBe(true);
      expect(outcome.state.cierre_motivo).toBe('frustracion_handoff');
    }
  });
});

describe('ConversationController — despedida sin pendientes', () => {
  it('llama closeConversation(despedida); resolved con mensaje de cierre', async () => {
    const intent = makeIntent({ intent: 'despedida', es_cierre: true });
    const deps = makeDeps(intent);
    const ctrl = new ConversationController(deps);

    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, 'gracias, chau');

    expect(deps.closeConversation).toHaveBeenCalledWith(ACCOUNT, PHONE, 'despedida');
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.state.cerrada).toBe(true);
      expect(outcome.state.cierre_motivo).toBe('despedida');
    }
  });
});

describe('ConversationController — despedida CON slot pendiente', () => {
  it('NO cierra; termina preguntando el slot pendiente (edad)', async () => {
    const stateWithPending = {
      ...createDialogueState(),
      fase: 'calificacion' as const,
      area: 'jubilacion_mujer',
      slots: {
        edad: { valor: null, estado: 'pendiente' as const, pedido_count: 0 },
      },
    };
    const intent = makeIntent({ intent: 'despedida', es_cierre: true });
    const deps = makeDeps(intent, {
      loadState: vi.fn().mockResolvedValue(stateWithPending),
    });
    const ctrl = new ConversationController(deps);

    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, 'gracias');

    expect(deps.closeConversation).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.messages[0]).toBe('PREGUNTA');
      expect(outcome.state.cerrada).toBe(false);
    }
    expect(deps.redactar).toHaveBeenCalledWith(
      expect.stringContaining('edad'),
      expect.any(Object),
    );
  });
});

describe('ConversationController — backstop cierre en contacto fresco', () => {
  it('es_cierre alucinado SIN despedida explícita en contacto fresco → NO cierra', async () => {
    // intent.es_cierre=true pero el label NO es 'despedida' y el contacto recién abre
    // (fase consulta, sin slots, sin redirecciones) → no debe cerrar.
    const intent = makeIntent({ intent: 'consultar', es_cierre: true });
    const deps = makeDeps(intent); // loadState default → estado fresco
    const ctrl = new ConversationController(deps);

    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, '¿hacen jubilaciones?');

    expect(deps.closeConversation).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('advance');
  });
});

describe('ConversationController — off_topic primera vez', () => {
  it('llama redactar con objetivo de redirección; resolved; redirecciones_offtopic=1; NO cierra', async () => {
    const intent = makeIntent({ intent: 'off_topic' });
    const deps = makeDeps(intent);
    const ctrl = new ConversationController(deps);

    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, 'que partido jugó river ayer');

    expect(deps.redactar).toHaveBeenCalled();
    expect(deps.closeConversation).not.toHaveBeenCalled();
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.state.redirecciones_offtopic).toBe(1);
    }
  });
});

describe('ConversationController — off_topic supera el tope', () => {
  it('cierra (closeConversation despedida) cuando supera offtopicTope:1 en la 2da llamada', async () => {
    const stateWithOneRedirection = {
      ...createDialogueState(),
      redirecciones_offtopic: 1,
    };
    const intent = makeIntent({ intent: 'off_topic' });
    const deps = makeDeps(intent, {
      loadState: vi.fn().mockResolvedValue(stateWithOneRedirection),
      offtopicTope: 1,
    });
    const ctrl = new ConversationController(deps);

    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, 'y el basquet?');

    expect(deps.closeConversation).toHaveBeenCalledWith(ACCOUNT, PHONE, 'despedida');
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.state.cerrada).toBe(true);
      expect(outcome.state.redirecciones_offtopic).toBe(2);
    }
  });
});

describe('ConversationController — responder_dato llena el slot → advance', () => {
  it('calificacion jubilacion_mujer con edad pendiente, aporta edad:61 → outcome advance', async () => {
    const stateWithPending = {
      ...createDialogueState(),
      fase: 'calificacion' as const,
      area: 'jubilacion_mujer',
      slots: {
        edad: { valor: null, estado: 'pendiente' as const, pedido_count: 0 },
      },
    };
    const intent = makeIntent({ intent: 'responder_dato', slots_detectados: { edad: 61 } });
    const deps = makeDeps(intent, {
      loadState: vi.fn().mockResolvedValue(stateWithPending),
    });
    const ctrl = new ConversationController(deps);

    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, 'tengo 61 años');

    expect(outcome.kind).toBe('advance');
    expect(deps.redactar).not.toHaveBeenCalled();
    expect(deps.closeConversation).not.toHaveBeenCalled();
    if (outcome.kind === 'advance') {
      expect(outcome.state.slots['edad']?.estado).toBe('lleno');
      expect(outcome.state.slots['edad']?.valor).toBe(61);
    }
  });
});

describe('ConversationController — anti-loop: slot atascado', () => {
  it('edad pendiente con pedido_count 3 → handoff + closeConversation(frustracion_handoff)', async () => {
    const stuckState = {
      ...createDialogueState(),
      fase: 'calificacion' as const,
      area: 'jubilacion_mujer',
      slots: {
        edad: { valor: null, estado: 'pendiente' as const, pedido_count: 3 },
      },
    };
    const intent = makeIntent({ intent: 'responder_dato', slots_detectados: {} });
    const deps = makeDeps(intent, {
      loadState: vi.fn().mockResolvedValue(stuckState),
    });
    const ctrl = new ConversationController(deps);

    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, 'no sé mi edad');

    expect(deps.handoff).toHaveBeenCalledWith(
      ACCOUNT,
      PHONE,
      expect.objectContaining({ motivo: 'slot_atascado:edad' }),
    );
    expect(deps.closeConversation).toHaveBeenCalledWith(ACCOUNT, PHONE, 'frustracion_handoff');
    expect(outcome.kind).toBe('resolved');
    if (outcome.kind === 'resolved') {
      expect(outcome.state.cerrada).toBe(true);
      expect(outcome.state.cierre_motivo).toBe('frustracion_handoff');
    }
  });
});

describe('ConversationController — consulta/FAQ', () => {
  it('fase consulta, intent consultar, sin área → advance (sin redactar ni cerrar)', async () => {
    const intent = makeIntent({ intent: 'consultar' });
    const deps = makeDeps(intent);
    const ctrl = new ConversationController(deps);

    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, 'cuándo me jubilo?');

    expect(outcome.kind).toBe('advance');
    expect(deps.redactar).not.toHaveBeenCalled();
    expect(deps.closeConversation).not.toHaveBeenCalled();
  });
});

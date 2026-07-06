// ─── ConversationController — tests unitarios (TDD, Fase 4a) ─────────────────
import { describe, it, expect, vi } from 'vitest';
import { ConversationController, isBareAck, type ControllerDeps } from '../ConversationController';
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

describe('ConversationController — Fix 1: contexto (historial) al clasificador', () => {
  it('pasa el historial reciente al classify (para que respuestas cortas no sean off_topic)', async () => {
    const intent = makeIntent({ intent: 'responder_dato', slots_detectados: { nacionalidad: 'argentino' } });
    const hist = [
      { role: 'assistant' as const, content: '¿De qué nacionalidad es?' },
      { role: 'user' as const, content: 'Argentino' },
    ];
    const deps = makeDeps(intent, { history: vi.fn().mockResolvedValue(hist) });
    const ctrl = new ConversationController(deps);
    await ctrl.handleTurn(ACCOUNT, PHONE, 'Argentino');
    expect(deps.history).toHaveBeenCalledWith(ACCOUNT, PHONE);
    // el classify recibió el historial en su ctx
    expect(deps.classify).toHaveBeenCalledWith('Argentino', expect.objectContaining({ history: hist }));
  });
});

describe('ConversationController — Fix 2: no cerrar a mitad de proceso', () => {
  it('despedida en fase calificacion (sin slots pendientes) NO cierra: continúa', async () => {
    const stateEnCalif = { ...createDialogueState(), fase: 'calificacion' as const, area: 'jubilacion', slots: {} };
    const intent = makeIntent({ intent: 'despedida', es_cierre: true });
    const deps = makeDeps(intent, { loadState: vi.fn().mockResolvedValue(stateEnCalif) });
    const ctrl = new ConversationController(deps);
    const outcome = await ctrl.handleTurn(ACCOUNT, PHONE, 'ok gracias');
    expect(deps.closeConversation).not.toHaveBeenCalled(); // NO cierra a mitad de calificación
    // jubilacion en calificacion siembra 'edad' → termina preguntándola
    expect(outcome.kind).toBe('resolved');
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

// ─── Cierre de conversación = silencio ───────────────────────────────────────

function makeClosedDeps(overrides: any = {}) {
  const state = { ...createDialogueState(), cerrada: true, cierre_motivo: 'completada' as const, fase: 'cerrada' as const };
  return {
    classify: vi.fn().mockResolvedValue({ intent: 'otro', quiere_continuar: true, nivel_frustracion: 0, es_cierre: false, slots_detectados: {}, confianza: 0.9 }),
    loadState: vi.fn().mockResolvedValue(state),
    saveState: vi.fn().mockResolvedValue(undefined),
    setOptOut: vi.fn(), closeConversation: vi.fn(), handoff: vi.fn(),
    redactar: vi.fn().mockResolvedValue('¿Me dice su edad?'),
    detectArea: () => null,
    now: () => '2026-07-02T12:00:00.000Z',
    ...overrides,
  };
}

describe('cierre de conversación', () => {
  it('isBareAck reconoce despedidas puras', () => {
    for (const t of ['gracias', 'Muchas gracias!!', 'ok', 'Dale', 'listo', 'Buenas noches', 'igualmente', '🙏', 'ok gracias']) {
      expect(isBareAck(t), t).toBe(true);
    }
    for (const t of ['gracias, ¿me mandan el link?', '¿de dónde son?', 'quiero cambiar el turno', 'no puedo ese día']) {
      expect(isBareAck(t), t).toBe(false);
    }
  });

  it('isBareAck NUNCA silencia preguntas (ni con vocabulario de cierre)', () => {
    expect(isBareAck('¿Qué día?')).toBe(false);
    expect(isBareAck('que dia era')).toBe(false);
    expect(isBareAck('???')).toBe(false);
    expect(isBareAck('Buenas noches')).toBe(true); // sigue siendo ack
  });

  it('conversación cerrada + despedida pura → silencio total, sin clasificar', async () => {
    const deps = makeClosedDeps();
    const out = await new ConversationController(deps as any).handleTurn('a1', 'p1', 'Muchas gracias');
    expect(out.kind).toBe('resolved');
    expect((out as any).messages).toEqual([]);
    expect(deps.classify).not.toHaveBeenCalled(); // ni un token gastado
  });

  it('conversación cerrada + contenido real → reabre y sigue el flujo normal', async () => {
    const deps = makeClosedDeps();
    const out = await new ConversationController(deps as any).handleTurn('a1', 'p1', '¿A esa hora no puedo, tienen más tarde?');
    expect(deps.classify).toHaveBeenCalled();
    const saved = deps.saveState.mock.calls.at(-1)?.[2];
    expect(saved.cerrada).toBe(false);
  });

  it('segunda despedida tras el cierre por despedida → silencio (no repite el template)', async () => {
    const state = { ...createDialogueState(), cerrada: true, cierre_motivo: 'despedida' as const, fase: 'cerrada' as const };
    const deps = makeClosedDeps({ loadState: vi.fn().mockResolvedValue(state) });
    const out = await new ConversationController(deps as any).handleTurn('a1', 'p1', 'Gracias');
    expect((out as any).messages).toEqual([]);
    expect(deps.closeConversation).not.toHaveBeenCalled();
  });

  it('cerrada por frustracion_handoff + contenido real → NO reabre (humano a cargo)', async () => {
    const state = { ...createDialogueState(), cerrada: true, cierre_motivo: 'frustracion_handoff' as const, fase: 'cerrada' as const };
    const deps = makeClosedDeps({ loadState: vi.fn().mockResolvedValue(state) });
    const out = await new ConversationController(deps as any).handleTurn('a1', 'p1', '¿Cuándo me van a llamar? Necesito una respuesta');
    expect(out.kind).toBe('resolved');
    expect((out as any).messages).toEqual([]);
    expect(deps.classify).not.toHaveBeenCalled(); // el bot no se reengancha sobre un handoff
  });
});

// ─── Anti-loop de calificación: streak de tema + directiva en advance ─────────

function makeAdvanceDeps(over: any = {}) {
  const state = { ...createDialogueState(), fase: 'calificacion' as const, area: 'jubilacion_mujer',
    slots: { edad: { valor: 61, estado: 'lleno' as const, pedido_count: 0 } },
    ask_streak: { topic: 'aportes' as const, count: 2 } };
  return {
    classify: vi.fn().mockResolvedValue({ intent: 'otro', quiere_continuar: true, nivel_frustracion: 0, es_cierre: false, slots_detectados: {}, confianza: 0.9 }),
    history: vi.fn().mockResolvedValue([{ role: 'assistant', content: '¿Cuántos años de aportes tiene?' }, { role: 'user', content: 'La Ferrere' }]),
    loadState: vi.fn().mockResolvedValue(state),
    saveState: vi.fn().mockResolvedValue(undefined),
    setOptOut: vi.fn(), closeConversation: vi.fn(), handoff: vi.fn(),
    redactar: vi.fn().mockResolvedValue('...'),
    detectArea: () => 'jubilacion_mujer',
    now: () => '2026-07-03T12:00:00.000Z',
    ...over,
  };
}

describe('ask_streak → directiva en advance', () => {
  it('bot preguntó aportes, cliente no respondió (streak 2→3) → advance con directive', async () => {
    const deps = makeAdvanceDeps();
    const out = await new ConversationController(deps as any).handleTurn('a1', 'p1', 'La Ferrere');
    expect(out.kind).toBe('advance');
    expect((out as any).directive).toMatch(/aportes/);
    const saved = deps.saveState.mock.calls.at(-1)?.[2];
    expect(saved.ask_streak).toEqual({ topic: 'aportes', count: 3 });
  });
  it('cliente responde el dato → streak reset, sin directive', async () => {
    // clave REAL del classifier ('anios_aporte', no 'aportes'); con texto sin número
    // el reset solo puede venir del alias map, no de la heurística clientAnswered.
    const deps = makeAdvanceDeps({ classify: vi.fn().mockResolvedValue({ intent: 'responder_dato', quiere_continuar: true, nivel_frustracion: 0, es_cierre: false, slots_detectados: { anios_aporte: 25 }, confianza: 0.9 }) });
    const out = await new ConversationController(deps as any).handleTurn('a1', 'p1', 'toda la vida en blanco');
    expect((out as any).directive).toBeFalsy();
    const saved = deps.saveState.mock.calls.at(-1)?.[2];
    expect(saved.ask_streak).toBeNull();
  });
});

// ─── ProspectExtractor integrado: extractor en paralelo al clasificador ──────

function extractorDeps(overrides: Partial<ControllerDeps> = {}): { deps: ControllerDeps; saved: any[] } {
  const saved: any[] = [];
  const deps: ControllerDeps = {
    classify: async () => ({
      intent: 'responder_dato', quiere_continuar: true, nivel_frustracion: 0,
      es_cierre: false, slots_detectados: {}, confianza: 0.9,
    }),
    history: async () => [],
    loadState: async () => null,
    saveState: async (_a, _p, s) => { saved.push(s); },
    setOptOut: async () => {},
    closeConversation: async () => {},
    handoff: async () => {},
    redactar: async (obj) => `[msg:${obj.slice(0, 20)}]`,
    detectArea: () => null,
    now: () => '2026-07-06T15:00:00.000Z',
    ...overrides,
  };
  return { deps, saved };
}

describe('ConversationController — ProspectExtractor integrado', () => {
  it('primer mensaje: llama extract y mergea slots + area al estado', async () => {
    let extractCalled = false;
    const { deps, saved } = extractorDeps({
      extract: async () => { extractCalled = true; return { slots: { nombre: 'Ana', edad: 63 }, area: 'jubilacion' }; },
    });
    const c = new ConversationController(deps);
    await c.handleTurn('acc', '549x', 'Hola soy Ana, 63 años, quiero jubilarme');
    expect(extractCalled).toBe(true);
    const final = saved[saved.length - 1];
    expect(final.slots.nombre?.valor).toBe('Ana');
    expect(final.slots.edad?.valor).toBe(63);
    expect(final.area).toBe('jubilacion');
    expect(final.extractor_last_at).toBe('2026-07-06T15:00:00.000Z');
  });

  it('mensaje corto con historial: NO llama extract', async () => {
    let extractCalled = false;
    const { deps } = extractorDeps({
      history: async () => [{ role: 'assistant', content: '¿Su edad?' }],
      extract: async () => { extractCalled = true; return { slots: {}, area: null }; },
    });
    const c = new ConversationController(deps);
    await c.handleTurn('acc', '549x', '63');
    expect(extractCalled).toBe(false);
  });

  it('extract rechaza (promise reject) → el turno sigue normal', async () => {
    const { deps, saved } = extractorDeps({
      extract: async () => { throw new Error('api caída'); },
    });
    const c = new ConversationController(deps);
    const out = await c.handleTurn('acc', '549x', 'Hola soy Ana, 63 años');
    expect(out.kind === 'resolved' || out.kind === 'advance').toBe(true);
    expect(saved.length).toBeGreaterThan(0);
  });

  it('el clasificador GANA sobre el extractor en el mismo slot (fase 5 mergea después)', async () => {
    const { deps, saved } = extractorDeps({
      classify: async () => ({
        intent: 'responder_dato', quiere_continuar: true, nivel_frustracion: 0,
        es_cierre: false, slots_detectados: { edad: 64 }, confianza: 0.9,
      }),
      extract: async () => ({ slots: { edad: 63 }, area: null }),
    });
    const c = new ConversationController(deps);
    await c.handleTurn('acc', '549x', 'Perdón, tengo 64, no 63. Como le decía, aporté 30 años en relación de dependencia y vivo en Quilmes centro.');
    const final = saved[saved.length - 1];
    expect(final.slots.edad?.valor).toBe(64);
  });
});

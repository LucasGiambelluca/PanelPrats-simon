import { describe, it, expect, vi } from 'vitest';
import { AgentRuntime } from '../AgentRuntime';

function makeDeps(aiScript: any[]) {
  let i = 0;
  return {
    ai: { completeWithTools: vi.fn(async () => aiScript[i++]) },
    persona: { build: vi.fn(() => 'system') },
    memory: { load: vi.fn().mockResolvedValue({ profile: {}, preferences: {}, summary: null, fichaText: 'FICHA: nuevo.' }) },
    tools: { schemas: vi.fn(() => []), execute: vi.fn() },
    loadAccount: vi.fn().mockResolvedValue({ accountId: 'acc1', agentName: 'Sofía' }),
    history: vi.fn().mockResolvedValue([]),
    updateMemory: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AgentRuntime.handle', () => {
  it('responde directo cuando el modelo no pide tools', async () => {
    const deps = makeDeps([{ content: 'Hola, soy Sofía' }]);
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'hola', {});
    expect(out).toEqual(['Hola, soy Sofía']);
    expect(deps.tools.execute).not.toHaveBeenCalled();
  });

  it('ejecuta una tool y vuelve a llamar al modelo con el resultado', async () => {
    const deps = makeDeps([
      { toolCalls: [{ id: 'c1', name: 'search_knowledge', args: { query: 'moratoria' } }] },
      { content: 'Sí, gestionamos moratoria.' },
    ]);
    deps.tools.execute = vi.fn().mockResolvedValue({ ok: true, data: { encontrado: true, snippets: ['x'] } });
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', '¿moratoria?', {});
    expect(deps.tools.execute).toHaveBeenCalledWith('search_knowledge', { query: 'moratoria' }, expect.objectContaining({ accountId: 'acc1', phone: '549111' }));
    expect(out).toEqual(['Sí, gestionamos moratoria.']);
  });

  it('inyecta continuidad al persona y la conversación al ctx de las tools', async () => {
    const deps = makeDeps([
      { toolCalls: [{ id: 'c1', name: 'book_appointment', args: {} }] },
      { content: 'Listo' },
    ]);
    deps.tools.execute = vi.fn().mockResolvedValue({ ok: true, data: {} });
    (deps as any).contextLoader = { load: vi.fn().mockResolvedValue({ isKnown: true, isReturning: true, recentHistory: [], lastOfferedOptions: [] }) };
    (deps as any).buildContinuity = vi.fn(() => 'CONTINUIDAD: ya habló antes.');
    const rt = new AgentRuntime(deps as any);
    await rt.handle('acc1', '549111', 'quiero turno', {});
    // persona recibió el bloque de continuidad
    expect(deps.persona.build).toHaveBeenCalledWith(expect.anything(), expect.anything(), 'CONTINUIDAD: ya habló antes.');
    // las tools reciben la conversación (para armar la ficha en book_appointment)
    const ctxArg = deps.tools.execute.mock.calls[0][2];
    expect(ctxArg.conversation).toContain('quiero turno');
  });

  it('si la IA falla (sin saldo/caída), degrada con cortesía y NO tira', async () => {
    const deps = makeDeps([]);
    deps.ai.completeWithTools = vi.fn().mockRejectedValue(new Error('429 quota'));
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'hola', {});
    expect(out).toHaveLength(1);
    expect(out[0].toLowerCase()).toContain('persona'); // fallback + derivación
    expect(deps.tools.execute).not.toHaveBeenCalled();
  });

  it('si hay un agendado activo, lo conduce el flujo determinístico (sin LLM)', async () => {
    const deps = makeDeps([{ content: 'no debería llamarse' }]);
    (deps as any).booking = {
      isActive: vi.fn().mockResolvedValue(true),
      advance: vi.fn().mockResolvedValue({ messages: ['Elegí 1, 2 o 3'], active: true }),
      start: vi.fn(),
    };
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'el primero', {});
    expect(out).toEqual(['Elegí 1, 2 o 3']);
    expect(deps.ai.completeWithTools).not.toHaveBeenCalled();   // NO pasó por el LLM
    expect((deps as any).booking.advance).toHaveBeenCalled();
  });

  it('start_booking del modelo arranca el flujo y corta el loop', async () => {
    const deps = makeDeps([{ toolCalls: [{ id: 'c1', name: 'start_booking', args: { modalidad: 'presencial', zona: 'Lanús' } }] }]);
    (deps as any).booking = {
      isActive: vi.fn().mockResolvedValue(false),
      advance: vi.fn(),
      start: vi.fn().mockResolvedValue({ messages: ['Tengo estos turnos en Quilmes: 1...'], active: true }),
    };
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'quiero un turno presencial, soy de Lanús', {});
    expect((deps as any).booking.start).toHaveBeenCalledWith('acc1', '549111', { modalidad: 'presencial', zona: 'Lanús', needsPhone: false }, expect.any(String));
    expect(out[0]).toMatch(/Quilmes/);
    expect(deps.tools.execute).not.toHaveBeenCalled();          // no ejecutó tools genéricas
  });

  it('start_booking bloqueado sin calificación vigente: no arranca booking y el modelo recibe el error', async () => {
    const deps = makeDeps([
      { toolCalls: [{ id: '1', name: 'start_booking', args: {} }] },
      { content: 'Antes le hago unas preguntas.' },
    ]);
    const start = vi.fn();
    (deps as any).booking = { isActive: vi.fn().mockResolvedValue(false), advance: vi.fn(), start };
    (deps as any).canStartBooking = vi.fn().mockResolvedValue({ ok: false, reason: 'falta calificar' });
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', 'p1', 'quiero turno por jubilación', {});
    expect(start).not.toHaveBeenCalled();
    expect(out).toEqual(['Antes le hago unas preguntas.']);
    const secondCall = (deps.ai.completeWithTools.mock.calls as any[])[1][0];
    const toolMsg = secondCall.messages.find((m: any) => m.role === 'tool' && m.name === 'start_booking');
    expect(toolMsg.content).toMatch(/falta calificar/);
  });

  it('corta y deriva si supera el máximo de iteraciones', async () => {
    const loopResp = { toolCalls: [{ id: 'c', name: 'search_knowledge', args: {} }] };
    const deps = makeDeps(Array(20).fill(loopResp));
    deps.tools.execute = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'loop', {});
    expect(out[0].toLowerCase()).toContain('persona'); // mensaje de cortesía + derivación
    expect(deps.ai.completeWithTools.mock.calls.length).toBe(5);
  });

  it('gate NO arranca booking si el mensaje toca un área de calificación (manda el LLM)', async () => {
    const deps = makeDeps([{ content: 'Soy Estela. ¿Me decís tu edad?' }]);
    (deps as any).booking = {
      isActive: vi.fn().mockResolvedValue(false),
      advance: vi.fn(),
      start: vi.fn().mockResolvedValue({ messages: ['NO debería arrancar'], active: true }),
    };
    (deps as any).bookingIntent = vi.fn(() => ({ start: true }));
    (deps as any).areaDetector = vi.fn(() => 'jubilacion_mujer');
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', '¿Puedo reservar una cita por Jubilación de mujer?', {});
    expect((deps as any).booking.start).not.toHaveBeenCalled();   // NO saltea el libreto
    expect(deps.ai.completeWithTools).toHaveBeenCalled();          // sí pasó por el LLM
    expect(out).toEqual(['Soy Estela. ¿Me decís tu edad?']);
  });

  it('gate SÍ arranca booking en un pedido de turno sin área', async () => {
    const deps = makeDeps([{ content: 'no debería llamarse el LLM' }]);
    (deps as any).booking = {
      isActive: vi.fn().mockResolvedValue(false),
      advance: vi.fn(),
      start: vi.fn().mockResolvedValue({ messages: ['¿Presencial o por videollamada?'], active: true }),
    };
    (deps as any).bookingIntent = vi.fn(() => ({ start: true }));
    (deps as any).areaDetector = vi.fn(() => null);
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'quiero sacar un turno', {});
    expect((deps as any).booking.start).toHaveBeenCalled();
    expect(deps.ai.completeWithTools).not.toHaveBeenCalled();
    expect(out).toEqual(['¿Presencial o por videollamada?']);
  });

  it('inyecta la CALIFICACIÓN PREVIA vigente en la ficha del persona', async () => {
    const deps = makeDeps([{ content: 'Listo' }]);
    (deps as any).memory = {
      load: vi.fn().mockResolvedValue({
        profile: {}, preferences: {}, summary: null, fichaText: 'FICHA: María.',
        calificacion: { jubilacion_mujer: { resultado: 'gratis', datos: { edad: 61 }, calificado_at: new Date().toISOString() } },
      }),
    };
    (deps as any).areaDetector = vi.fn(() => 'jubilacion_mujer');
    (deps as any).loadAccount = vi.fn().mockResolvedValue({ accountId: 'acc1', agentName: 'Sofía', calificacionTtlDays: 30 });
    const rt = new AgentRuntime(deps as any);
    await rt.handle('acc1', '549111', 'hola de nuevo', {});
    const fichaArg = (deps.persona.build.mock.calls[0] as unknown[])[1] as string;
    expect(fichaArg).toContain('FICHA: María.');
    expect(fichaArg).toContain('CALIFICACIÓN PREVIA');
    expect(fichaArg).toContain('Jubilación Mujer');
  });

  it('controller "resolved" corta el turno: devuelve sus mensajes y NO llama al tool-loop', async () => {
    const deps = makeDeps([{ content: 'NO debería llamarse el LLM' }]);
    (deps as any).conversation = {
      handleTurn: vi.fn().mockResolvedValue({ kind: 'resolved', messages: ['Listo, no le vamos a escribir más. 🙏'] }),
    };
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'no me escriban mas', {});
    expect((deps as any).conversation.handleTurn).toHaveBeenCalledWith('acc1', '549111', 'no me escriban mas');
    expect(out).toEqual(['Listo, no le vamos a escribir más. 🙏']);
    expect(deps.ai.completeWithTools).not.toHaveBeenCalled();   // turno resuelto antes del tool-loop
  });

  it('turno silencioso (resolved sin mensajes) NO gasta LLM en updateMemory', async () => {
    const deps = makeDeps([{ content: 'NO debería llamarse el LLM' }]);
    (deps as any).conversation = {
      handleTurn: vi.fn().mockResolvedValue({ kind: 'resolved', messages: [] }),
    };
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'gracias', {});
    expect(out).toEqual([]);
    expect(deps.ai.completeWithTools).not.toHaveBeenCalled();
    expect(deps.updateMemory).not.toHaveBeenCalled(); // silencio = cero llamadas IA
  });

  it('controller "advance" delega: corre el tool-loop normalmente', async () => {
    const deps = makeDeps([{ content: 'Sí, gestionamos moratoria.' }]);
    (deps as any).conversation = {
      handleTurn: vi.fn().mockResolvedValue({ kind: 'advance' }),
    };
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', '¿hacen moratoria?', {});
    expect((deps as any).conversation.handleTurn).toHaveBeenCalled();
    expect(deps.ai.completeWithTools).toHaveBeenCalled();        // delegó al tool-loop
    expect(out).toEqual(['Sí, gestionamos moratoria.']);
  });

  it('con agendado ACTIVO, BookingFlow conduce y el controller NO se invoca', async () => {
    const deps = makeDeps([{ content: 'no debería' }]);
    (deps as any).booking = {
      isActive: vi.fn().mockResolvedValue(true),
      advance: vi.fn().mockResolvedValue({ messages: ['Elegí 1, 2 o 3'], active: true }),
      start: vi.fn(),
    };
    (deps as any).conversation = { handleTurn: vi.fn() };
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'el primero', {});
    expect((deps as any).booking.advance).toHaveBeenCalled();
    expect((deps as any).conversation.handleTurn).not.toHaveBeenCalled(); // mid-agendado saltea el controller
    expect(out).toEqual(['Elegí 1, 2 o 3']);
  });
});

describe('AgentRuntime — LoopGuard (tope de llamadas IA por conversación)', () => {
  function withGuard(aiScript: any[], accountLoopGuard: any, initialState: any) {
    const deps = makeDeps(aiScript);
    deps.loadAccount = vi.fn().mockResolvedValue({ accountId: 'acc1', agentName: 'Sofía', loopGuard: accountLoopGuard });
    const saveState = vi.fn().mockResolvedValue(undefined);
    const onBlock = vi.fn().mockResolvedValue(undefined);
    (deps as any).now = () => 1_000_000;
    (deps as any).loopGuard = {
      loadState: vi.fn().mockResolvedValue(initialState),
      saveState,
      onBlock,
    };
    return { deps, saveState, onBlock };
  }

  it('al superar el tope: deriva a humano y NO llama a la IA (action=handoff)', async () => {
    const now = 1_000_000;
    const { deps, onBlock } = withGuard(
      [{ content: 'no debería llamarse' }],
      { enabled: true, maxCalls: 2, windowMin: 60, action: 'handoff' },
      { calls: [now - 1000, now - 2000], replies: [] },
    );
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'hola?', {});
    expect(deps.ai.completeWithTools).not.toHaveBeenCalled();
    expect(onBlock).toHaveBeenCalledWith('acc1', '549111', 'rate');
    expect(out).toHaveLength(1);
    expect(out[0].toLowerCase()).toContain('persona'); // FALLBACK de derivación
  });

  it('al superar el tope con action=silence: no responde nada (devuelve [])', async () => {
    const now = 1_000_000;
    const { deps, onBlock } = withGuard(
      [{ content: 'no debería llamarse' }],
      { enabled: true, maxCalls: 2, windowMin: 60, action: 'silence' },
      { calls: [now - 1000, now - 2000], replies: [] },
    );
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'hola?', {});
    expect(deps.ai.completeWithTools).not.toHaveBeenCalled();
    expect(onBlock).not.toHaveBeenCalled(); // silence no deriva
    expect(out).toEqual([]);
  });

  it('por debajo del tope: responde normal, cuenta la llamada y persiste el estado', async () => {
    const { deps, saveState } = withGuard(
      [{ content: 'Hola, soy Sofía' }],
      { enabled: true, maxCalls: 5, windowMin: 60, action: 'handoff' },
      { calls: [], replies: [] },
    );
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'hola', {});
    expect(out).toEqual(['Hola, soy Sofía']);
    expect(saveState).toHaveBeenCalled();
    const saved = saveState.mock.calls[0][2];
    expect(saved.calls).toHaveLength(1); // contó esta llamada
  });

  it('anti-eco: si la respuesta repite la anterior, no la reenvía y deriva', async () => {
    const { deps, onBlock } = withGuard(
      [{ content: 'Hola, soy Sofía del estudio.' }],
      { enabled: true, maxCalls: 50, windowMin: 60, echoGuard: true, echoLookback: 3, action: 'handoff' },
      { calls: [], replies: ['hola, soy sofía del estudio.'] },
    );
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'hola', {});
    expect(onBlock).toHaveBeenCalledWith('acc1', '549111', 'echo');
    expect(out[0].toLowerCase()).toContain('persona'); // derivó en vez de repetir
  });

  it('sin deps.loopGuard funciona igual que antes (no rompe nada)', async () => {
    const deps = makeDeps([{ content: 'Hola' }]);
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'hola', {});
    expect(out).toEqual(['Hola']);
  });
});

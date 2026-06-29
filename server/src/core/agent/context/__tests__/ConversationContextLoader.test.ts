import { describe, it, expect, vi } from 'vitest';
import {
  isReturning, buildContinuityBlock, ConversationContextLoader, type ConversationContext,
} from '../ConversationContextLoader';

const DAY = 86400000;
const now = new Date('2026-06-26T12:00:00.000Z');

describe('isReturning', () => {
  it('contacto que escribió ayer y es conocido → true', () => {
    expect(isReturning({ lastInteractionAt: new Date(now.getTime() - DAY), isKnown: true }, now)).toBe(true);
  });
  it('última interacción hace 30 días → false (no saludo de continuidad)', () => {
    expect(isReturning({ lastInteractionAt: new Date(now.getTime() - 30 * DAY), isKnown: true }, now)).toBe(false);
  });
  it('contacto nuevo (sin interacción previa) → false', () => {
    expect(isReturning({ lastInteractionAt: null, isKnown: false }, now)).toBe(false);
  });
});

describe('buildContinuityBlock', () => {
  const base: ConversationContext = {
    contact: {}, longTermSummary: null, openAppointment: null, lastTopic: null,
    lastInteractionAt: null, recentHistory: [], lastOfferedOptions: [], isReturning: false, isKnown: false,
  };

  it('contacto nuevo → bloque vacío', () => {
    expect(buildContinuityBlock(base)).toBe('');
  });

  it('contacto conocido → instruye retomar, no reiniciar', () => {
    const block = buildContinuityBlock({
      ...base, isKnown: true, isReturning: true,
      longTermSummary: 'Consultó por su jubilación, le faltan aportes.',
      lastTopic: 'jubilacion',
    });
    expect(block).toContain('NO reinicies');
    expect(block).toContain('jubilación');
  });

  it('con cita abierta → la menciona', () => {
    const block = buildContinuityBlock({
      ...base, isKnown: true,
      openAppointment: { id: 'a1', start_time: '2026-07-03T18:00:00.000Z', oficina: 'Quilmes', status: 'pendiente', fechaTexto: 'jue 03/07 15:00' } as any,
    });
    expect(block).toContain('jue 03/07 15:00');
    expect(block.toLowerCase()).toContain('cita');
  });
});

describe('ConversationContextLoader.load — orquestación', () => {
  function makeLoader(over: any = {}) {
    return new ConversationContextLoader({
      loadMemory: over.loadMemory ?? vi.fn().mockResolvedValue({ profile: {}, preferences: {}, summary: null, lastInteractionAt: null, lastTopic: null, currentThread: null }),
      history: over.history ?? vi.fn().mockResolvedValue([]),
      nextAppointment: over.nextAppointment ?? vi.fn().mockResolvedValue(null),
      offeredOptions: over.offeredOptions ?? vi.fn().mockResolvedValue([]),
      now: () => now,
    });
  }

  it('arma contexto de contacto NUEVO', async () => {
    const ctx = await makeLoader().load('acc1', '549111');
    expect(ctx.isKnown).toBe(false);
    expect(ctx.isReturning).toBe(false);
  });

  it('reconoce contacto con resumen aunque Redis (historial) esté vacío — rehidratación', async () => {
    const loader = makeLoader({
      loadMemory: vi.fn().mockResolvedValue({
        profile: { nombre: 'María' }, preferences: {}, summary: 'Consultó moratoria.',
        lastInteractionAt: new Date(now.getTime() - 2 * DAY), lastTopic: 'jubilacion', currentThread: null,
      }),
      history: vi.fn().mockResolvedValue([]), // Redis vacío
    });
    const ctx = await loader.load('acc1', '549111');
    expect(ctx.isKnown).toBe(true);
    expect(ctx.isReturning).toBe(true);
    expect(ctx.longTermSummary).toContain('moratoria');
  });

  it('incluye la cita abierta y las opciones ofrecidas', async () => {
    const loader = makeLoader({
      nextAppointment: vi.fn().mockResolvedValue({ id: 'a1', start_time: '2026-07-03T18:00:00.000Z', oficina: 'Quilmes', status: 'pendiente' }),
      offeredOptions: vi.fn().mockResolvedValue([{ index: 1, label: 'CABA', value: 'CABA' }]),
    });
    const ctx = await loader.load('acc1', '549111');
    expect(ctx.openAppointment?.id).toBe('a1');
    expect(ctx.lastOfferedOptions).toHaveLength(1);
  });

  it('degrada con gracia: si loadMemory falla, no rompe (contexto vacío)', async () => {
    const loader = makeLoader({ loadMemory: vi.fn().mockRejectedValue(new Error('db caída')) });
    const ctx = await loader.load('acc1', '549111');
    expect(ctx.isKnown).toBe(false);
    expect(ctx.recentHistory).toEqual([]);
  });
});

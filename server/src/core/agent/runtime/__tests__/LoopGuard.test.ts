import { describe, it, expect } from 'vitest';
import {
  normalizeLoopGuardConfig,
  normalizeReply,
  evaluateRate,
  isEchoReply,
  recordCall,
  recordReply,
  DEFAULT_LOOP_GUARD,
  type LoopGuardState,
} from '../LoopGuard';

const emptyState = (): LoopGuardState => ({ calls: [], replies: [] });

describe('normalizeLoopGuardConfig', () => {
  it('cae a defaults cuando no hay config', () => {
    expect(normalizeLoopGuardConfig(null)).toEqual(DEFAULT_LOOP_GUARD);
    expect(normalizeLoopGuardConfig(undefined)).toEqual(DEFAULT_LOOP_GUARD);
  });

  it('mergea sobre los defaults sin perder los campos no provistos', () => {
    const c = normalizeLoopGuardConfig({ maxCalls: 5 });
    expect(c.maxCalls).toBe(5);
    expect(c.windowMin).toBe(DEFAULT_LOOP_GUARD.windowMin);
    expect(c.action).toBe(DEFAULT_LOOP_GUARD.action);
  });

  it('clampa valores inválidos a algo seguro', () => {
    const c = normalizeLoopGuardConfig({ maxCalls: -3, windowMin: -10, echoLookback: 0 });
    expect(c.maxCalls).toBeGreaterThanOrEqual(1);
    expect(c.windowMin).toBeGreaterThanOrEqual(0);
    expect(c.echoLookback).toBeGreaterThanOrEqual(1);
  });

  it('acepta solo acciones válidas; cae a handoff si es desconocida', () => {
    expect(normalizeLoopGuardConfig({ action: 'silence' }).action).toBe('silence');
    expect(normalizeLoopGuardConfig({ action: 'cooldown' }).action).toBe('cooldown');
    expect(normalizeLoopGuardConfig({ action: 'meliante' }).action).toBe('handoff');
  });
});

describe('evaluateRate — ventana deslizante (Opción A)', () => {
  const cfg = normalizeLoopGuardConfig({ maxCalls: 3, windowMin: 60 });

  it('no bloquea por debajo del tope', () => {
    const now = 1_000_000;
    const state: LoopGuardState = { calls: [now - 1000, now - 2000], replies: [] };
    expect(evaluateRate(state, cfg, now).blocked).toBe(false);
  });

  it('bloquea al alcanzar maxCalls dentro de la ventana', () => {
    const now = 1_000_000;
    const state: LoopGuardState = { calls: [now - 1000, now - 2000, now - 3000], replies: [] };
    expect(evaluateRate(state, cfg, now).blocked).toBe(true);
  });

  it('ignora llamadas fuera de la ventana (auto-reset)', () => {
    const now = 100 * 60_000; // 100 min
    const old = now - 61 * 60_000; // 61 min atrás → fuera de la ventana de 60
    const state: LoopGuardState = { calls: [old, old, old], replies: [] };
    expect(evaluateRate(state, cfg, now).blocked).toBe(false);
  });
});

describe('evaluateRate — tope total (Opción B, windowMin=0)', () => {
  const cfg = normalizeLoopGuardConfig({ maxCalls: 3, windowMin: 0 });

  it('nunca resetea: cuenta todas las llamadas históricas', () => {
    const now = 10_000_000;
    const state: LoopGuardState = { calls: [1, 2, 3], replies: [] };
    expect(evaluateRate(state, cfg, now).blocked).toBe(true);
  });
});

describe('evaluateRate — deshabilitado', () => {
  it('nunca bloquea si enabled=false', () => {
    const cfg = normalizeLoopGuardConfig({ enabled: false, maxCalls: 1 });
    const now = 1_000_000;
    const state: LoopGuardState = { calls: [now, now, now, now], replies: [] };
    expect(evaluateRate(state, cfg, now).blocked).toBe(false);
  });
});

describe('isEchoReply — anti repetición (Opción C)', () => {
  const cfg = normalizeLoopGuardConfig({ echoGuard: true, echoLookback: 3 });

  it('detecta respuesta casi idéntica reciente (ignora espacios/mayúsculas)', () => {
    const state: LoopGuardState = { calls: [], replies: [normalizeReply('Hola, soy Sofía del estudio.')] };
    expect(isEchoReply(state, '  hola,  SOY  sofía del estudio.  ', cfg)).toBe(true);
  });

  it('no marca eco cuando la respuesta es distinta', () => {
    const state: LoopGuardState = { calls: [], replies: [normalizeReply('Hola, soy Sofía.')] };
    expect(isEchoReply(state, 'Tu turno quedó el martes.', cfg)).toBe(false);
  });

  it('no marca eco si echoGuard=false', () => {
    const off = normalizeLoopGuardConfig({ echoGuard: false });
    const state: LoopGuardState = { calls: [], replies: [normalizeReply('repetida')] };
    expect(isEchoReply(state, 'repetida', off)).toBe(false);
  });
});

describe('recordCall', () => {
  it('agrega el timestamp y purga lo viejo cuando hay ventana', () => {
    const cfg = normalizeLoopGuardConfig({ maxCalls: 10, windowMin: 60 });
    const now = 100 * 60_000;
    const old = now - 61 * 60_000;
    const next = recordCall({ calls: [old], replies: [] }, cfg, now);
    expect(next.calls).toEqual([now]); // viejo purgado, nuevo agregado
  });

  it('conserva el historial completo cuando windowMin=0', () => {
    const cfg = normalizeLoopGuardConfig({ maxCalls: 10, windowMin: 0 });
    const next = recordCall({ calls: [1, 2], replies: [] }, cfg, 3);
    expect(next.calls).toEqual([1, 2, 3]);
  });
});

describe('recordReply', () => {
  it('guarda la respuesta normalizada y recorta a echoLookback', () => {
    const cfg = normalizeLoopGuardConfig({ echoLookback: 2 });
    let s = emptyState();
    s = recordReply(s, cfg, 'Uno');
    s = recordReply(s, cfg, 'Dos');
    s = recordReply(s, cfg, 'Tres');
    expect(s.replies).toEqual([normalizeReply('Dos'), normalizeReply('Tres')]);
  });
});

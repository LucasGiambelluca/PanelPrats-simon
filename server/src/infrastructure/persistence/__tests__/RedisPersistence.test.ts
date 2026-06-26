import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/redis', () => {
  const store = new Map<string, string>();
  return {
    redis: {
      set: vi.fn((k: string, v: string) => { store.set(k, v); return Promise.resolve('OK'); }),
      setex: vi.fn((k: string, _ttl: number, v: string) => { store.set(k, v); return Promise.resolve('OK'); }),
      get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
      del: vi.fn((k: string) => { store.delete(k); return Promise.resolve(1); }),
      status: 'ready',
    },
  };
});

// Capture the columns passed to .select(...) and feed back canned rows.
const capturedSelect: { arg?: string } = {};
vi.mock('../../../config/database', () => {
  // El query ordena DESC por created_at; getHistory hace .reverse() para
  // dejar el historial en orden cronológico ascendente.
  const rows = [
    { content: 'buenas, ¿en qué te ayudo?', direction: 'OUTBOUND', created_at: '2026-01-01T00:00:01Z' },
    { content: 'hola', direction: 'INBOUND', created_at: '2026-01-01T00:00:00Z' },
  ];
  const builder: any = {
    select: vi.fn((arg: string) => { capturedSelect.arg = arg; return builder; }),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),   // getHistory ahora filtra el phone con .in(variants)
    order: vi.fn(() => builder),
    limit: vi.fn(() => Promise.resolve({ data: rows, error: null })),
  };
  return {
    supabase: { from: vi.fn(() => builder) },
  };
});

import { redisPersistence } from '../RedisPersistenceService';

describe('RedisPersistenceService accountId', () => {
  it('checkpoints de cuentas distintas no colisionan para el mismo phone', async () => {
    await redisPersistence.setCheckpoint('accA', '549111', { node: 'a' });
    await redisPersistence.setCheckpoint('accB', '549111', { node: 'b' });
    expect((await redisPersistence.getCheckpoint('accA', '549111')).node).toBe('a');
    expect((await redisPersistence.getCheckpoint('accB', '549111')).node).toBe('b');
  });
});

describe('RedisPersistenceService.getHistory', () => {
  it('selecciona columnas reales y mapea direction -> role', async () => {
    const history = await redisPersistence.getHistory('accA', '549111', 10);

    // Selecciona columnas que SÍ existen en whatsapp_messages
    expect(capturedSelect.arg).toBe('content, direction, created_at');

    // OUTBOUND => assistant, lo demás => user; usa `content` como texto.
    expect(history).toEqual([
      { role: 'user', content: 'hola' },
      { role: 'assistant', content: 'buenas, ¿en qué te ayudo?' },
    ]);
  });
});

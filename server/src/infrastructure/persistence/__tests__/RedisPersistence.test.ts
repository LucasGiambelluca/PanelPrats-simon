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

import { redisPersistence } from '../RedisPersistenceService';

describe('RedisPersistenceService accountId', () => {
  it('checkpoints de cuentas distintas no colisionan para el mismo phone', async () => {
    await redisPersistence.setCheckpoint('accA', '549111', { node: 'a' });
    await redisPersistence.setCheckpoint('accB', '549111', { node: 'b' });
    expect((await redisPersistence.getCheckpoint('accA', '549111')).node).toBe('a');
    expect((await redisPersistence.getCheckpoint('accB', '549111')).node).toBe('b');
  });
});

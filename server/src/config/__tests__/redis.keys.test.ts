import { describe, it, expect } from 'vitest';

describe('config clients', () => {
  it('supabase exporta un cliente con .from()', async () => {
    const { supabase } = await import('../supabase');
    expect(typeof supabase.from).toBe('function');
  });

  it('redis exporta una instancia ioredis', async () => {
    const { redis } = await import('../redis');
    expect(typeof redis.get).toBe('function');
    // disconnect() es síncrono y no envía comando; quit() falla offline con enableOfflineQueue:false.
    redis.disconnect();
  });
});

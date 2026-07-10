import { describe, it, expect, vi, beforeEach } from 'vitest';

// Fake Redis in-memory (listas + sorted set) con la API que usa WebhookQueue.
const h = vi.hoisted(() => {
  const lists = new Map<string, string[]>();
  const zsets = new Map<string, Map<string, number>>();
  const L = (k: string) => { if (!lists.has(k)) lists.set(k, []); return lists.get(k)!; };
  const redis = {
    lpush: vi.fn(async (k: string, v: string) => { L(k).unshift(v); return L(k).length; }),
    rpoplpush: vi.fn(async (src: string, dst: string) => {
      const v = L(src).pop();
      if (v === undefined) return null;
      L(dst).unshift(v);
      return v;
    }),
    lrem: vi.fn(async (k: string, count: number, v: string) => {
      const a = L(k); let removed = 0;
      for (let i = 0; i < a.length && removed < Math.abs(count);) {
        if (a[i] === v) { a.splice(i, 1); removed++; } else i++;
      }
      return removed;
    }),
    zadd: vi.fn(async (k: string, score: number, m: string) => {
      if (!zsets.has(k)) zsets.set(k, new Map());
      zsets.get(k)!.set(m, Number(score));
      return 1;
    }),
    zrangebyscore: vi.fn(async (k: string, _min: string, max: string | number, _l: string, _o: number, count: number) => {
      const z = zsets.get(k); if (!z) return [];
      const out: string[] = [];
      for (const [m, s] of z) { if (s <= Number(max)) out.push(m); if (out.length >= count) break; }
      return out;
    }),
    zrem: vi.fn(async (k: string, m: string) => { const z = zsets.get(k); return z && z.delete(m) ? 1 : 0; }),
  };
  return { lists, zsets, L, redis };
});

vi.mock('../../config/redis', () => ({ redis: h.redis }));
vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { WebhookQueue } from '../WebhookQueue';

const QUEUE = 'wh:queue';
const PROCESSING = 'wh:processing';
const RETRY = 'wh:retry';
const DEADLETTER = 'wh:deadletter';

function makeManager() {
  return {
    handleMetaWebhook: vi.fn().mockResolvedValue(undefined),
    handleWhatsAppWebhook: vi.fn().mockResolvedValue(undefined),
  } as any;
}

beforeEach(() => {
  h.lists.clear();
  h.zsets.clear();
  vi.clearAllMocks();
});

describe('WebhookQueue.enqueue', () => {
  it('encola el job con attempts=0 en la cola', async () => {
    const q = new WebhookQueue(makeManager());
    await q.enqueue('meta', { id: 'PAGE' });
    expect(h.L(QUEUE)).toHaveLength(1);
    expect(JSON.parse(h.L(QUEUE)[0])).toEqual({ kind: 'meta', entry: { id: 'PAGE' }, attempts: 0 });
  });
});

describe('WebhookQueue.tick', () => {
  it('procesa un job OK: llama al handler y limpia processing', async () => {
    const mgr = makeManager();
    const q = new WebhookQueue(mgr);
    await q.enqueue('meta', { id: 'PAGE' });

    await q.tick();

    expect(mgr.handleMetaWebhook).toHaveBeenCalledWith({ id: 'PAGE' });
    expect(h.L(QUEUE)).toHaveLength(0);
    expect(h.L(PROCESSING)).toHaveLength(0);
    expect(h.zsets.get(RETRY)?.size ?? 0).toBe(0);
  });

  it('rutea whatsapp al handler correcto', async () => {
    const mgr = makeManager();
    const q = new WebhookQueue(mgr);
    await q.enqueue('whatsapp', { id: 'WABA' });
    await q.tick();
    expect(mgr.handleWhatsAppWebhook).toHaveBeenCalledWith({ id: 'WABA' });
    expect(mgr.handleMetaWebhook).not.toHaveBeenCalled();
  });

  it('en fallo: reencola a wh:retry con backoff y attempts incrementado (no dead-letter)', async () => {
    const mgr = makeManager();
    mgr.handleMetaWebhook.mockRejectedValue(new Error('boom'));
    const q = new WebhookQueue(mgr);
    await q.enqueue('meta', { id: 'PAGE' });

    await q.tick();

    expect(h.L(PROCESSING)).toHaveLength(0);
    expect(h.L(DEADLETTER) ?? []).toHaveLength(0);
    const retry = h.zsets.get(RETRY)!;
    expect(retry.size).toBe(1);
    const [member] = [...retry.keys()];
    expect(JSON.parse(member).attempts).toBe(1);
  });

  it('tras MAX_ATTEMPTS el job va a dead-letter', async () => {
    const mgr = makeManager();
    mgr.handleMetaWebhook.mockRejectedValue(new Error('boom'));
    const q = new WebhookQueue(mgr);
    // job ya con 4 intentos: el próximo fallo (5 = MAX) lo manda a dead-letter.
    h.L(QUEUE).unshift(JSON.stringify({ kind: 'meta', entry: { id: 'PAGE' }, attempts: 4 }));

    await q.tick();

    expect(h.zsets.get(RETRY)?.size ?? 0).toBe(0);
    expect(h.L(DEADLETTER)).toHaveLength(1);
    const dl = JSON.parse(h.L(DEADLETTER)[0]);
    expect(dl.attempts).toBe(5);
    expect(dl.error).toContain('boom');
  });

  it('promueve retries vencidos y los procesa', async () => {
    const mgr = makeManager();
    const q = new WebhookQueue(mgr);
    // retry vencido (readyAt en el pasado)
    h.zsets.set(RETRY, new Map([[JSON.stringify({ kind: 'meta', entry: { id: 'R' }, attempts: 2 }), 1]]));

    await q.tick();

    expect(mgr.handleMetaWebhook).toHaveBeenCalledWith({ id: 'R' });
    expect(h.zsets.get(RETRY)!.size).toBe(0);
  });

  it('job ilegible se descarta de processing sin romper', async () => {
    const mgr = makeManager();
    const q = new WebhookQueue(mgr);
    h.L(QUEUE).unshift('{ no-json');
    await q.tick();
    expect(h.L(PROCESSING)).toHaveLength(0);
    expect(mgr.handleMetaWebhook).not.toHaveBeenCalled();
  });
});

describe('WebhookQueue.recoverProcessing', () => {
  it('mueve jobs colgados de processing de vuelta a la cola', async () => {
    const q = new WebhookQueue(makeManager());
    h.L(PROCESSING).push(JSON.stringify({ kind: 'meta', entry: { id: 'X' }, attempts: 0 }));
    await (q as any).recoverProcessing();
    expect(h.L(PROCESSING)).toHaveLength(0);
    expect(h.L(QUEUE)).toHaveLength(1);
  });

  // Caso prod 2026-07-10: al boot Redis todavía no conectó (enableOfflineQueue=false),
  // recover tiraba "Stream isn't writeable" UNA vez y los jobs colgados en
  // wh:processing quedaban varados hasta el próximo reinicio.
  it('si recover falla al boot (Redis caído), un tick posterior lo reintenta y rescata el job', async () => {
    const mgr = makeManager();
    const q = new WebhookQueue(mgr);
    h.L(PROCESSING).push(JSON.stringify({ kind: 'meta', entry: { id: 'X' }, attempts: 0 }));

    // Redis caído durante el primer intento de recover (el del tick 1).
    h.redis.rpoplpush.mockRejectedValueOnce(new Error("Stream isn't writeable and enableOfflineQueue options is false"));
    await q.tick().catch(() => { /* el error del tick se loguea, no tumba el worker */ });
    expect(h.L(PROCESSING)).toHaveLength(1); // sigue varado

    // Redis ya conectado: el próximo tick recupera y procesa.
    await q.tick();
    expect(h.L(PROCESSING)).toHaveLength(0);
    expect(mgr.handleMetaWebhook).toHaveBeenCalledWith({ id: 'X' });
  });
});

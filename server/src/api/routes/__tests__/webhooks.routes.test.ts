import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// Mock supabase: respuesta configurable por test.
const supabaseResult: { data: any } = { data: [] };
vi.mock('../../../config/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => Promise.resolve(supabaseResult),
        }),
      }),
    }),
  },
}));

import { verifyMetaSignature, metaWebhookRouter } from '../webhooks.routes';

function sign(body: string, secret: string): string {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(body)).digest('hex');
}

describe('verifyMetaSignature', () => {
  const secret = 'app_secret_123';
  const raw = JSON.stringify({ object: 'page', entry: [{ id: 'P' }] });

  it('acepta una firma válida', () => {
    expect(verifyMetaSignature(Buffer.from(raw), secret, sign(raw, secret))).toBe(true);
  });

  it('rechaza firma con secreto incorrecto', () => {
    expect(verifyMetaSignature(Buffer.from(raw), secret, sign(raw, 'otro'))).toBe(false);
  });

  it('rechaza cuerpo alterado', () => {
    const tampered = raw + ' ';
    expect(verifyMetaSignature(Buffer.from(tampered), secret, sign(raw, secret))).toBe(false);
  });

  it('rechaza header/secret/body faltantes o algoritmo distinto', () => {
    expect(verifyMetaSignature(Buffer.from(raw), undefined, sign(raw, secret))).toBe(false);
    expect(verifyMetaSignature(Buffer.from(raw), secret, undefined)).toBe(false);
    expect(verifyMetaSignature(undefined, secret, sign(raw, secret))).toBe(false);
    expect(verifyMetaSignature(Buffer.from(raw), secret, 'sha1=abc')).toBe(false);
  });
});

// Helpers para simular req/res de express e invocar los handlers del router.
function getHandler(router: any, method: 'get' | 'post') {
  const layer = router.stack.find((l: any) => l.route && l.route.methods[method] && l.route.path === '/');
  return layer.route.stack[0].handle;
}
function makeRes() {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    send(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; },
    sendStatus(code: number) { this.statusCode = code; this.body = code; return this; },
  };
  return res;
}

describe('metaWebhookRouter GET verify', () => {
  beforeEach(() => { supabaseResult.data = []; });

  it('200 + challenge cuando hay cuenta con verify_token y mode=subscribe', async () => {
    supabaseResult.data = [{ id: 'acc1' }];
    const handler = getHandler(metaWebhookRouter({} as any), 'get');
    const req: any = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': 'CH' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('CH');
  });

  it('403 cuando no hay cuenta con ese verify_token', async () => {
    supabaseResult.data = [];
    const handler = getHandler(metaWebhookRouter({} as any), 'get');
    const req: any = { query: { 'hub.mode': 'subscribe', 'hub.verify_token': 'tok', 'hub.challenge': 'CH' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });

  it('403 cuando mode != subscribe', async () => {
    supabaseResult.data = [{ id: 'acc1' }];
    const handler = getHandler(metaWebhookRouter({} as any), 'get');
    const req: any = { query: { 'hub.mode': 'x', 'hub.verify_token': 'tok' } };
    const res = makeRes();
    await handler(req, res);
    expect(res.statusCode).toBe(403);
  });
});

describe('metaWebhookRouter POST', () => {
  beforeEach(() => { supabaseResult.data = []; });

  const secret = 'sek';
  const payload = { object: 'page', entry: [{ id: 'PAGE1', messaging: [{ sender: { id: 'U' }, message: { text: 'hi' } }] }] };
  const raw = JSON.stringify(payload);

  function makeReq(signature?: string) {
    return {
      body: payload,
      rawBody: Buffer.from(raw),
      header: (name: string) => (name === 'X-Hub-Signature-256' ? signature : undefined),
    } as any;
  }

  it('firma válida => enruta entry al manager y responde 200', async () => {
    supabaseResult.data = [{ app_secret: secret }];
    const handleMetaWebhook = vi.fn().mockResolvedValue(undefined);
    const handler = getHandler(metaWebhookRouter({ handleMetaWebhook } as any), 'post');
    const res = makeRes();
    await handler(makeReq(sign(raw, secret)), res);
    expect(handleMetaWebhook).toHaveBeenCalledWith(payload.entry[0]);
    expect(res.statusCode).toBe(200);
  });

  it('firma inválida => 403 y no enruta', async () => {
    supabaseResult.data = [{ app_secret: secret }];
    const handleMetaWebhook = vi.fn();
    const handler = getHandler(metaWebhookRouter({ handleMetaWebhook } as any), 'post');
    const res = makeRes();
    await handler(makeReq(sign(raw, 'mal')), res);
    expect(handleMetaWebhook).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('sin app_secret => 403 y no enruta (default seguro)', async () => {
    delete process.env.META_WEBHOOK_INSECURE;
    supabaseResult.data = [{ app_secret: null }];
    const handleMetaWebhook = vi.fn();
    const handler = getHandler(metaWebhookRouter({ handleMetaWebhook } as any), 'post');
    const res = makeRes();
    await handler(makeReq(sign(raw, secret)), res);
    expect(handleMetaWebhook).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(403);
  });

  it('sin app_secret + META_WEBHOOK_INSECURE=1 => enruta y responde 200', async () => {
    process.env.META_WEBHOOK_INSECURE = '1';
    supabaseResult.data = [{ app_secret: null }];
    const handleMetaWebhook = vi.fn().mockResolvedValue(undefined);
    const handler = getHandler(metaWebhookRouter({ handleMetaWebhook } as any), 'post');
    const res = makeRes();
    await handler(makeReq(undefined), res);
    expect(handleMetaWebhook).toHaveBeenCalledWith(payload.entry[0]);
    expect(res.statusCode).toBe(200);
    delete process.env.META_WEBHOOK_INSECURE;
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const posts: any[] = [];
vi.mock('axios', () => ({
  default: { post: (url: string, body: any) => { posts.push({ url, body }); return Promise.resolve({ data: {} }); } },
}));

import { MetaClient } from '../MetaClient';

describe('MetaClient.extractInbound', () => {
  it('extrae senderId/text de un entry de Messenger (FB)', () => {
    const entry = { id: 'PAGE123', messaging: [{ sender: { id: 'USER1' }, message: { text: 'hola' } }] };
    expect(MetaClient.extractInbound(entry)).toEqual([{ senderId: 'USER1', text: 'hola' }]);
  });

  it('ignora echoes (is_echo) y eventos sin texto', () => {
    const entry = {
      id: 'PAGE123',
      messaging: [
        { sender: { id: 'USER1' }, message: { is_echo: true, text: 'eco' } },
        { sender: { id: 'USER2' }, message: { attachments: [{ type: 'image' }] } }, // sin text
        { sender: { id: 'USER3' }, read: { watermark: 1 } },                         // no es mensaje
        { sender: { id: 'USER4' }, message: { text: 'real' } },
      ],
    };
    expect(MetaClient.extractInbound(entry)).toEqual([{ senderId: 'USER4', text: 'real' }]);
  });

  it('extrae de IG en formato changes[].value', () => {
    const entry = {
      id: 'IG123',
      changes: [{ field: 'messages', value: { messaging: [{ sender: { id: 'IGUSER' }, message: { text: 'dm' } }] } }],
    };
    expect(MetaClient.extractInbound(entry)).toEqual([{ senderId: 'IGUSER', text: 'dm' }]);
  });

  it('extrae de IG cuando value es el messaging item directo', () => {
    const entry = {
      id: 'IG123',
      changes: [{ value: { sender: { id: 'IGUSER2' }, message: { text: 'hi' } } }],
    };
    expect(MetaClient.extractInbound(entry)).toEqual([{ senderId: 'IGUSER2', text: 'hi' }]);
  });

  it('es seguro ante entries malformados', () => {
    expect(MetaClient.extractInbound(null)).toEqual([]);
    expect(MetaClient.extractInbound({})).toEqual([]);
    expect(MetaClient.extractInbound({ messaging: 'nope' } as any)).toEqual([]);
  });
});

describe('MetaClient.coerceText', () => {
  it('coacciona string/{text}/{message}', () => {
    expect(MetaClient.coerceText('hola')).toBe('hola');
    expect(MetaClient.coerceText({ text: 'a' })).toBe('a');
    expect(MetaClient.coerceText({ message: 'b' })).toBe('b');
    expect(MetaClient.coerceText(null)).toBe('');
    expect(MetaClient.coerceText({ poll: {} })).toBe('');
  });
});

describe('MetaClient status', () => {
  it('start con token => connected; sin token => disconnected', async () => {
    const store = { record: vi.fn() } as any;
    const onMsg = vi.fn();
    const withTok = new MetaClient('a', 'facebook', { externalId: 'P', accessToken: 'tok' }, onMsg, store);
    await withTok.start();
    expect(withTok.getStatus()).toBe('connected');

    const noTok = new MetaClient('a', 'instagram', { externalId: 'P', accessToken: '' }, onMsg, store);
    await noTok.start();
    expect(noTok.getStatus()).toBe('disconnected');
    expect(noTok.getQrCode()).toBeNull();
  });
});

describe('MetaClient.handleEvent', () => {
  beforeEach(() => { posts.length = 0; });

  it('persiste INBOUND, enruta y responde por la Graph API', async () => {
    const recorded: any[] = [];
    const store = { record: (m: any) => { recorded.push(m); return Promise.resolve(); } } as any;
    const onMsg = vi.fn().mockResolvedValue(['respuesta', { text: 'segunda' }]);

    const client = new MetaClient('acc1', 'facebook', { externalId: 'PAGE', accessToken: 'TKN' }, onMsg, store);
    await client.handleEvent({ id: 'PAGE', messaging: [{ sender: { id: 'PSID1' }, message: { text: 'hola' } }] });

    expect(onMsg).toHaveBeenCalledWith('acc1', 'PSID1', 'hola', 'PSID1', {});

    // 1 INBOUND + 2 OUTBOUND
    expect(recorded.filter((r) => r.direction === 'INBOUND')).toHaveLength(1);
    expect(recorded.filter((r) => r.direction === 'OUTBOUND')).toHaveLength(2);
    expect(recorded[0]).toMatchObject({ accountId: 'acc1', phone: 'PSID1', direction: 'INBOUND', content: 'hola' });

    // 2 POSTs a la Graph API con el recipient correcto
    expect(posts).toHaveLength(2);
    expect(posts[0].url).toContain('graph.facebook.com');
    expect(posts[0].url).toContain('access_token=TKN');
    expect(posts[0].body).toEqual({ recipient: { id: 'PSID1' }, message: { text: 'respuesta' } });
    expect(posts[1].body.message.text).toBe('segunda');
  });

  it('no envía nada si no hay inbound de texto', async () => {
    const store = { record: vi.fn() } as any;
    const onMsg = vi.fn();
    const client = new MetaClient('acc1', 'instagram', { externalId: 'IG', accessToken: 'TKN' }, onMsg, store);
    await client.handleEvent({ id: 'IG', messaging: [{ sender: { id: 'U' }, message: { is_echo: true, text: 'x' } }] });
    expect(onMsg).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
  });
});

describe('MetaClient.sendMessage', () => {
  beforeEach(() => { posts.length = 0; });

  it('no hace POST si falta accessToken', async () => {
    const store = { record: vi.fn() } as any;
    const client = new MetaClient('acc1', 'facebook', { externalId: 'P', accessToken: '' }, vi.fn(), store);
    await client.sendMessage('U', 'hola');
    expect(posts).toHaveLength(0);
  });
});

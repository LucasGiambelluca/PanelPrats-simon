import { describe, it, expect, vi, beforeEach } from 'vitest';

const posts: any[] = [];
vi.mock('axios', () => ({
  default: { post: (url: string, body: any) => { posts.push({ url, body }); return Promise.resolve({ data: {} }); } },
}));

// Por defecto el claim de idempotencia deja pasar (primera vez).
const claim = vi.fn().mockResolvedValue(true);
vi.mock('../../../services/idempotency', () => ({ claimWebhookMessage: (...a: any[]) => claim(...a) }));

import { WhatsAppOfficialClient } from '../WhatsAppOfficialClient';

const cfg = { phone_number_id: 'PNID', accessToken: 'TKN', waba_id: 'WABA' };

function makeValue(id: string, body = 'hola') {
  return {
    contacts: [{ wa_id: '549111', profile: { name: 'Lucas' } }],
    messages: [{ id, from: '549111', type: 'text', text: { body } }],
  };
}

describe('WhatsAppOfficialClient.handleWebhookEvent', () => {
  beforeEach(() => { posts.length = 0; claim.mockReset().mockResolvedValue(true); });

  it('procesa el inbound, persiste con waMessageId y responde', async () => {
    const recorded: any[] = [];
    const store = { record: (m: any) => { recorded.push(m); return Promise.resolve(); } } as any;
    const onMsg = vi.fn().mockResolvedValue(['respuesta']);
    const client = new WhatsAppOfficialClient('acc1', cfg, onMsg, store);

    await client.handleWebhookEvent(makeValue('wamid.A'));

    expect(claim).toHaveBeenCalledWith('wamid.A');
    expect(onMsg).toHaveBeenCalledWith('acc1', '549111', 'hola', 'Lucas', {});
    expect(recorded.find((r) => r.direction === 'INBOUND')).toMatchObject({ waMessageId: 'wamid.A' });
    expect(posts).toHaveLength(1);
  });

  it('idempotencia: un mensaje duplicado (claim=false) no se procesa ni responde', async () => {
    claim.mockResolvedValue(false); // Meta reintenta el mismo wamid
    const store = { record: vi.fn() } as any;
    const onMsg = vi.fn().mockResolvedValue(['respuesta']);
    const client = new WhatsAppOfficialClient('acc1', cfg, onMsg, store);

    await client.handleWebhookEvent(makeValue('wamid.A'));

    expect(store.record).not.toHaveBeenCalled();
    expect(onMsg).not.toHaveBeenCalled();
    expect(posts).toHaveLength(0);
  });

  it('respuesta de botón interactivo: rutea el id y guarda el título', async () => {
    const recorded: any[] = [];
    const store = { record: (m: any) => { recorded.push(m); return Promise.resolve(); } } as any;
    const onMsg = vi.fn().mockResolvedValue([]);
    const client = new WhatsAppOfficialClient('acc1', cfg, onMsg, store);

    const value = {
      contacts: [{ wa_id: '549111', profile: { name: 'Lucas' } }],
      messages: [{ id: 'wamid.B', from: '549111', type: 'interactive',
        interactive: { type: 'button_reply', button_reply: { id: '2', title: 'Despido / ART' } } }],
    };
    await client.handleWebhookEvent(value);

    // el motor recibe el id ("2") para resolver option-1
    expect(onMsg).toHaveBeenCalledWith('acc1', '549111', '2', 'Lucas', {});
    // el inbox guarda el título legible
    expect(recorded.find((r) => r.direction === 'INBOUND')).toMatchObject({ content: 'Despido / ART' });
  });

  it('envía mensaje interactivo (botones) cuando la respuesta trae .interactive', async () => {
    const store = { record: vi.fn() } as any;
    const interactive = { type: 'button', body: { text: 'Elegí' }, action: { buttons: [{ type: 'reply', reply: { id: '1', title: 'A' } }] } };
    const onMsg = vi.fn().mockResolvedValue([{ text: 'Elegí\n\n• A', interactive }]);
    const client = new WhatsAppOfficialClient('acc1', cfg, onMsg, store);

    await client.handleWebhookEvent(makeValue('wamid.C'));

    expect(posts).toHaveLength(1);
    expect(posts[0].body.type).toBe('interactive');
    expect(posts[0].body.interactive).toEqual(interactive);
  });
});

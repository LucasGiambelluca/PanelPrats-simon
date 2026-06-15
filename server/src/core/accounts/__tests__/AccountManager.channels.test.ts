import { describe, it, expect, vi, beforeEach } from 'vitest';

// Cuenta devuelta por supabase según el id/external_id consultado.
const accountsById: Record<string, any> = {};
const accountsByExternal: Record<string, any> = {};

vi.mock('../../../config/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: (col: string, val: string) => ({
          maybeSingle: () => Promise.resolve({ data: col === 'id' ? accountsById[val] ?? null : null }),
          limit: () => Promise.resolve({ data: col === 'external_id' ? [accountsByExternal[val]].filter(Boolean) : [] }),
        }),
      }),
    }),
  },
}));
vi.mock('../../../services/MessageStore', () => ({ messageStore: { record: vi.fn() } }));

const waSent: any[] = [];
vi.mock('../../../infrastructure/whatsapp/WhatsAppClient', () => ({
  WhatsAppClient: class {
    constructor(public accountId: string) {}
    async start() {}
    async stop() {}
    getQrCode() { return `qr-${this.accountId}`; }
    getStatus() { return 'connected'; }
    async sendFormattedMessage(jid: string, text: string) { waSent.push({ jid, text }); }
  },
}));

const metaEvents: any[] = [];
const metaSent: any[] = [];
vi.mock('../../../infrastructure/meta/MetaClient', () => {
  class MetaClient {
    constructor(public accountId: string, public channel: string, public config: any) {}
    async start() {}
    async stop() {}
    getStatus() { return 'connected'; }
    getQrCode() { return null; }
    async sendMessage(to: string, text: string) { metaSent.push({ accountId: this.accountId, to, text }); }
    async handleEvent(entry: any) { metaEvents.push({ accountId: this.accountId, entry }); }
  }
  return { MetaClient };
});

import { AccountManager } from '../AccountManager';

describe('AccountManager omnichannel', () => {
  beforeEach(() => {
    for (const k of Object.keys(accountsById)) delete accountsById[k];
    for (const k of Object.keys(accountsByExternal)) delete accountsByExternal[k];
    waSent.length = 0; metaSent.length = 0; metaEvents.length = 0;
  });

  it('connect crea WhatsAppClient para canal whatsapp (o sin fila)', async () => {
    const mgr = new AccountManager({} as any);
    const c = await mgr.connect('waAcc');
    expect((c as any).constructor.name).toBe('WhatsAppClient');
    expect(mgr.getQr('waAcc')).toBe('qr-waAcc');
  });

  it('connect crea MetaClient para canal facebook', async () => {
    accountsById['fbAcc'] = { id: 'fbAcc', channel: 'facebook', external_id: 'PAGE1', access_token: 'tok' };
    const mgr = new AccountManager({} as any);
    const c = await mgr.connect('fbAcc');
    expect((c as any).constructor.name).toBe('MetaClient');
    expect(mgr.getQr('fbAcc')).toBeNull();
    expect(mgr.getStatus('fbAcc')).toBe('connected');
  });

  it('sendMessage usa Graph API en meta y jid en whatsapp', async () => {
    accountsById['fbAcc'] = { id: 'fbAcc', channel: 'instagram', external_id: 'IG1', access_token: 'tok' };
    const mgr = new AccountManager({} as any);
    await mgr.connect('fbAcc');
    await mgr.connect('waAcc');

    await mgr.sendMessage('fbAcc', 'PSID9', 'hola meta');
    await mgr.sendMessage('waAcc', '549111', 'hola wa');

    expect(metaSent).toEqual([{ accountId: 'fbAcc', to: 'PSID9', text: 'hola meta' }]);
    expect(waSent).toEqual([{ jid: '549111@s.whatsapp.net', text: 'hola wa' }]);
  });

  it('handleMetaWebhook enruta el entry por external_id al MetaClient', async () => {
    accountsById['fbAcc'] = { id: 'fbAcc', channel: 'facebook', external_id: 'PAGE7', access_token: 'tok' };
    accountsByExternal['PAGE7'] = { id: 'fbAcc', channel: 'facebook', external_id: 'PAGE7', access_token: 'tok' };
    const mgr = new AccountManager({} as any);

    const entry = { id: 'PAGE7', messaging: [] };
    await mgr.handleMetaWebhook(entry);

    expect(metaEvents).toEqual([{ accountId: 'fbAcc', entry }]);
  });

  it('handleMetaWebhook ignora external_id sin cuenta', async () => {
    const mgr = new AccountManager({} as any);
    await mgr.handleMetaWebhook({ id: 'UNKNOWN' });
    expect(metaEvents).toHaveLength(0);
  });
});

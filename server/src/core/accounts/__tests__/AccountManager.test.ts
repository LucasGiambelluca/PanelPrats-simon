import { describe, it, expect, vi } from 'vitest';

const started: string[] = [];
vi.mock('../../../infrastructure/whatsapp/WhatsAppClient', () => ({
  WhatsAppClient: class {
    constructor(public accountId: string) {}
    async start() { started.push(this.accountId); }
    async stop() {}
    getQrCode() { return `qr-${this.accountId}`; }
    getStatus() { return 'connected'; }
    async sendFormattedMessage() {}
  },
}));
vi.mock('../../../services/MessageStore', () => ({ messageStore: {} }));
vi.mock('../../../config/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }) } }));

import { AccountManager } from '../AccountManager';

describe('AccountManager', () => {
  it('mantiene un cliente por cuenta y aísla QR', async () => {
    const mgr = new AccountManager({} as any);
    await mgr.connect('accA');
    await mgr.connect('accB');
    expect(mgr.getQr('accA')).toBe('qr-accA');
    expect(mgr.getQr('accB')).toBe('qr-accB');
    expect(started).toEqual(['accA', 'accB']);
  });

  it('connect dos veces la misma cuenta no duplica el cliente', async () => {
    started.length = 0;
    const mgr = new AccountManager({} as any);
    await mgr.connect('accA');
    await mgr.connect('accA');
    expect(started).toEqual(['accA']);
  });
});

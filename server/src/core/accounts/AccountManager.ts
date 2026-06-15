import { WhatsAppClient } from '../../infrastructure/whatsapp/WhatsAppClient';
import { FlowEngine } from '../engine/flow.engine';
import { ConversationRouter } from '../engine/conversation.router';
import { messageStore } from '../../services/MessageStore';
import { supabase } from '../../config/supabase';

const AUTH_BASE_PATH = process.env.AUTH_BASE_PATH || './auth';

export class AccountManager {
  private clients = new Map<string, WhatsAppClient>();
  private router: ConversationRouter;

  constructor(engine: FlowEngine) {
    this.router = new ConversationRouter(engine);
  }

  /** Levanta (o devuelve) el cliente Baileys de una cuenta. */
  async connect(accountId: string): Promise<WhatsAppClient> {
    let client = this.clients.get(accountId);
    if (client) return client;

    client = new WhatsAppClient(
      accountId,
      AUTH_BASE_PATH,
      (accId, phone, text, pushName, fileCtx) => this.router.processMessage(accId, phone, text, pushName, fileCtx),
      messageStore,
    );
    this.clients.set(accountId, client);

    try {
      await client.start();
    } catch (err) {
      // aislamiento: una cuenta que falla no tumba a las demás
      console.error(`[AccountManager] cuenta ${accountId} falló al iniciar:`, err);
    }
    return client;
  }

  async disconnect(accountId: string): Promise<void> {
    const client = this.clients.get(accountId);
    if (!client) return;
    await client.stop();
    this.clients.delete(accountId);
  }

  getQr(accountId: string): string | null {
    return this.clients.get(accountId)?.getQrCode() ?? null;
  }

  getStatus(accountId: string): string {
    return this.clients.get(accountId)?.getStatus() ?? 'disconnected';
  }

  async sendMessage(accountId: string, phone: string, text: string): Promise<void> {
    const client = this.clients.get(accountId);
    if (!client) throw new Error(`Cuenta ${accountId} no conectada`);
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    await client.sendFormattedMessage(jid, text);
  }

  /** Al bootear: reconecta todas las cuentas marcadas como conectadas. */
  async bootstrapExisting(): Promise<void> {
    const { data } = await supabase.from('accounts').select('id').eq('status', 'connected');
    for (const row of data ?? []) {
      await this.connect(row.id as string);
    }
  }
}

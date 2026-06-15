import { WhatsAppClient } from '../../infrastructure/whatsapp/WhatsAppClient';
import { MetaClient } from '../../infrastructure/meta/MetaClient';
import type { MetaChannel } from '../../infrastructure/meta/MetaClient';
import { FlowEngine } from '../engine/flow.engine';
import { ConversationRouter } from '../engine/conversation.router';
import { messageStore } from '../../services/MessageStore';
import { supabase } from '../../config/supabase';

const AUTH_BASE_PATH = process.env.AUTH_BASE_PATH || './auth';

type AnyClient = WhatsAppClient | MetaClient;

export class AccountManager {
  private clients = new Map<string, AnyClient>();
  private router: ConversationRouter;

  constructor(engine: FlowEngine) {
    this.router = new ConversationRouter(engine);
  }

  /** Levanta (o devuelve) el cliente de una cuenta, según su canal. */
  async connect(accountId: string): Promise<AnyClient> {
    let client = this.clients.get(accountId);
    if (client) return client;

    const account = await this.fetchAccount(accountId);
    const channel = (account?.channel as string) || 'whatsapp';

    if (channel === 'facebook' || channel === 'instagram') {
      client = new MetaClient(
        accountId,
        channel as MetaChannel,
        { externalId: account?.external_id ?? '', accessToken: account?.access_token ?? '' },
        (accId, phone, text, pushName, fileCtx) => this.router.processMessage(accId, phone, text, pushName, fileCtx),
        messageStore,
      );
    } else {
      client = new WhatsAppClient(
        accountId,
        AUTH_BASE_PATH,
        (accId, phone, text, pushName, fileCtx) => this.router.processMessage(accId, phone, text, pushName, fileCtx),
        messageStore,
      );
    }
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
    const client = this.clients.get(accountId);
    if (!client) return null;
    // MetaClient no tiene QR; ambos exponen getQrCode().
    return (client as any).getQrCode?.() ?? null;
  }

  getStatus(accountId: string): string {
    return this.clients.get(accountId)?.getStatus() ?? 'disconnected';
  }

  async sendMessage(accountId: string, to: string, text: string): Promise<void> {
    const client = this.clients.get(accountId);
    if (!client) throw new Error(`Cuenta ${accountId} no conectada`);

    if (client instanceof MetaClient) {
      await client.sendMessage(to, text);
      return;
    }

    // WhatsApp: jid logic + formato/anti-ban
    const jid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    await client.sendFormattedMessage(jid, text);
  }

  /**
   * Enruta un `entry` del webhook de Meta al MetaClient correcto (por external_id).
   * Asegura que la cuenta esté conectada antes de procesar.
   */
  async handleMetaWebhook(entry: any): Promise<void> {
    const externalId = entry?.id;
    if (!externalId) return;

    const account = await this.fetchAccountByExternalId(externalId);
    if (!account?.id) {
      console.warn(`[AccountManager] webhook Meta sin cuenta para external_id=${externalId}`);
      return;
    }

    let client = this.clients.get(account.id);
    if (!(client instanceof MetaClient)) {
      // Aún no instanciado (o reinicio): lo levantamos.
      client = await this.connect(account.id);
    }

    if (client instanceof MetaClient) {
      await client.handleEvent(entry);
    }
  }

  /** Al bootear: reconecta todas las cuentas marcadas como conectadas (cualquier canal). */
  async bootstrapExisting(): Promise<void> {
    const { data } = await supabase.from('accounts').select('id').eq('status', 'connected');
    for (const row of data ?? []) {
      await this.connect(row.id as string);
    }
  }

  private async fetchAccount(accountId: string): Promise<any | null> {
    try {
      const { data } = await supabase
        .from('accounts')
        .select('id, channel, external_id, access_token')
        .eq('id', accountId)
        .maybeSingle();
      return data ?? null;
    } catch {
      return null;
    }
  }

  private async fetchAccountByExternalId(externalId: string): Promise<any | null> {
    try {
      const { data } = await supabase
        .from('accounts')
        .select('id, channel, external_id, access_token')
        .eq('external_id', externalId)
        .limit(1);
      return data?.[0] ?? null;
    } catch {
      return null;
    }
  }
}

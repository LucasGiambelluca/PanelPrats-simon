import { WhatsAppClient } from '../../infrastructure/whatsapp/WhatsAppClient';
import { MetaClient } from '../../infrastructure/meta/MetaClient';
import type { MetaChannel } from '../../infrastructure/meta/MetaClient';
import { WhatsAppOfficialClient } from '../../infrastructure/meta/WhatsAppOfficialClient';
import { FlowEngine } from '../engine/flow.engine';
import { ConversationRouter } from '../engine/conversation.router';
import { messageStore } from '../../services/MessageStore';
import { supabase } from '../../config/supabase';
import { memoryAccounts } from './memoryStore';

const AUTH_BASE_PATH = process.env.AUTH_BASE_PATH || './auth';

type AnyClient = WhatsAppClient | MetaClient | WhatsAppOfficialClient;

export class AccountManager {
  private clients = new Map<string, AnyClient>();
  private router: ConversationRouter;

  constructor(engine: FlowEngine) {
    this.router = new ConversationRouter(engine);
  }

  /**
   * Levanta (o devuelve) el cliente de una cuenta, según su canal.
   *
   * `opts.resume`: reanuda una sesión existente sin re-emparejar. Lo usan el
   * bootstrap y los reinicios para NO borrar las credenciales Baileys guardadas
   * (de lo contrario cada restart del server desconecta el número y pide QR nuevo).
   * El connect manual del usuario (QR nuevo) va con resume=false.
   */
  async connect(accountId: string, opts: { resume?: boolean } = {}): Promise<AnyClient> {
    let client = this.clients.get(accountId);
    if (client) {
      if (client.getStatus() === 'STOPPED' || client.getStatus() === 'disconnected') {
        console.log(`[AccountManager] Client ${accountId} is stopped/disconnected. Restarting...`);
        try {
          // Reanudar: nunca limpiar la sesión de un cliente que ya existía.
          if (client instanceof WhatsAppClient) await client.start(true);
          else await client.start();
        } catch (err) {
          console.error(`[AccountManager] Failed to restart client ${accountId}:`, err);
        }
      }
      return client;
    }

    const account = await this.fetchAccount(accountId);
    const channel = (account?.channel as string) || 'whatsapp';
    const provider = (account?.provider as string) || 'baileys';

    if (channel === 'facebook' || channel === 'instagram') {
      client = new MetaClient(
        accountId,
        channel as MetaChannel,
        { externalId: account?.external_id ?? '', accessToken: account?.access_token ?? '' },
        (accId, phone, text, pushName, fileCtx) => this.router.processMessage(accId, phone, text, pushName, fileCtx),
        messageStore,
      );
    } else if (channel === 'whatsapp' && provider === 'official') {
      client = new WhatsAppOfficialClient(
        accountId,
        {
          phone_number_id: account?.external_id ?? '',
          accessToken: account?.access_token ?? '',
          waba_id: '',
        },
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
      // resume=true (bootstrap/restart) => isRestart=true => NO se limpia la sesión guardada.
      if (client instanceof WhatsAppClient) await client.start(opts.resume === true);
      else await client.start();
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
    // MetaClient y WhatsAppOfficialClient no tienen QR; ambos exponen getQrCode().
    return (client as any).getQrCode?.() ?? null;
  }

  getStatus(accountId: string): string {
    return this.clients.get(accountId)?.getStatus() ?? 'disconnected';
  }

  async sendMessage(accountId: string, to: string, text: string): Promise<void> {
    const client = this.clients.get(accountId);
    if (!client) throw new Error(`Cuenta ${accountId} no conectada`);

    if (client instanceof MetaClient || client instanceof WhatsAppOfficialClient) {
      await client.sendMessage(to, text);
      return;
    }

    // WhatsApp: resolver el JID REAL (onWhatsApp) para manejar el "9" de Argentina
    // y fallar de verdad si el número no está en WhatsApp (en vez de un ok falso).
    let jid = to;
    if (!to.includes('@') && typeof (client as any).resolveJid === 'function') {
      const resolved = await (client as any).resolveJid(to);
      if (!resolved) throw new Error(`El número ${to} no está registrado en WhatsApp`);
      jid = resolved;
    } else if (!to.includes('@')) {
      jid = `${to}@s.whatsapp.net`;
    }
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

  /**
   * Enruta un `entry` del webhook de WhatsApp Official al WhatsAppOfficialClient correcto.
   */
  async handleWhatsAppWebhook(entry: any): Promise<void> {
    const changes = entry?.changes || [];
    for (const change of changes) {
      if (change.field !== 'messages') continue;
      const phone_number_id = change.value?.metadata?.phone_number_id;
      if (!phone_number_id) continue;

      const account = await this.fetchAccountByExternalId(phone_number_id);
      if (!account?.id) {
        console.warn(`[AccountManager] webhook WhatsApp sin cuenta para phone_number_id=${phone_number_id}`);
        continue;
      }

      let client = this.clients.get(account.id);
      if (!(client instanceof WhatsAppOfficialClient)) {
        client = await this.connect(account.id);
      }

      if (client instanceof WhatsAppOfficialClient) {
        await client.handleWebhookEvent(change.value);
      }
    }
  }

  /** Al bootear: reconecta todas las cuentas marcadas como conectadas (cualquier canal). */
  async bootstrapExisting(): Promise<void> {
    // 1. Reconnect memory accounts in development/fallback mode
    for (const [id, acc] of memoryAccounts.entries()) {
      if (acc.status === 'connected' || acc.status === 'qr') {
        console.log(`[AccountManager] Bootstrapping memory account: ${acc.name} (${id})`);
        await this.connect(id, { resume: true }).catch(err => {
          console.error(`[AccountManager] Failed to bootstrap memory account ${id}:`, err);
        });
      }
    }

    const isSupabaseConfigured = !!(
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_KEY &&
      !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
      !process.env.SUPABASE_SERVICE_KEY.includes('...')
    );

    if (!isSupabaseConfigured) return;

    try {
      const { data } = await supabase.from('accounts').select('id').eq('status', 'connected');
      for (const row of data ?? []) {
        await this.connect(row.id as string, { resume: true });
      }
    } catch (e) {
      console.error('[bootstrap] error reconectando cuentas existentes:', e);
    }
  }

  private async fetchAccount(accountId: string): Promise<any | null> {
    const isSupabaseConfigured = !!(
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_KEY &&
      !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
      !process.env.SUPABASE_SERVICE_KEY.includes('...')
    );

    if (!isSupabaseConfigured) {
      return memoryAccounts.get(accountId) || null;
    }

    try {
      const { data } = await supabase
        .from('accounts')
        .select('id, channel, external_id, access_token, provider')
        .eq('id', accountId)
        .maybeSingle();
      if (data) return data;
    } catch (err: any) {
      console.error(`[AccountManager] Error fetching account ${accountId} from Supabase, falling back to memory:`, err?.message ?? err);
    }

    return memoryAccounts.get(accountId) || null;
  }

  private async fetchAccountByExternalId(externalId: string): Promise<any | null> {
    const isSupabaseConfigured = !!(
      process.env.SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_KEY &&
      !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
      !process.env.SUPABASE_SERVICE_KEY.includes('...')
    );

    if (!isSupabaseConfigured) {
      return Array.from(memoryAccounts.values()).find(a => a.external_id === externalId) || null;
    }

    try {
      const { data } = await supabase
        .from('accounts')
        .select('id, channel, external_id, access_token, provider')
        .eq('external_id', externalId)
        .limit(1);
      if (data && data[0]) return data[0];
    } catch (err: any) {
      console.error(`[AccountManager] Error fetching account by external_id ${externalId} from Supabase, falling back to memory:`, err?.message ?? err);
    }

    return Array.from(memoryAccounts.values()).find(a => a.external_id === externalId) || null;
  }
}

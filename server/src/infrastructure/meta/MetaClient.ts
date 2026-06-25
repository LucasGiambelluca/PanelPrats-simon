import axios from 'axios';
import { logger } from '../../utils/logger';
import { supabase } from '../../config/supabase';
import type { MessageStore } from '../../services/MessageStore';
import type { ChannelClient } from '../../core/channels/ChannelClient';
import { claimWebhookMessage } from '../../services/idempotency';
import { withRetry } from '../../utils/retry';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;
// Instagram API "con Instagram Login" (tokens IGAA…): NO usa graph.facebook.com,
// va contra graph.instagram.com con el mismo shape de mensajería.
const GRAPH_IG = `https://graph.instagram.com/${GRAPH_VERSION}`;

export type MetaChannel = 'facebook' | 'instagram';

export interface MetaConfig {
  externalId: string;   // FB page id / IG account id (= entry.id en el webhook)
  accessToken: string;  // Page Access Token de Meta
}

type MetaStatus = 'connected' | 'disconnected';

/**
 * Cliente para Facebook Messenger e Instagram Direct vía Graph API.
 *
 * No mantiene socket: el inbound llega por webhook HTTP (`handleEvent`) y el
 * outbound se envía por POST a la Graph API (`sendMessage`). El mismo endpoint
 * `/me/messages` sirve para Messenger e IG cuando el token es el Page Token
 * vinculado a la cuenta de Instagram.
 *
 * Al recibir un mensaje lo persiste (INBOUND) y lo delega a `onMessage`
 * (inyectado por AccountManager → ConversationRouter), igual que WhatsAppClient.
 * En `onMessage`, "phone" es el PSID (FB) o IGSID (IG) del usuario.
 */
export class MetaClient implements ChannelClient {
  private status: MetaStatus = 'disconnected';
  // Cache PSID/IGSID -> nombre del perfil (evita pedir a Graph en cada mensaje).
  private profileNames = new Map<string, string>();

  constructor(
    private accountId: string,
    public readonly channel: MetaChannel,
    private config: MetaConfig,
    private onMessage: (accountId: string, phone: string, text: string, pushName: string, fileCtx: any) => Promise<any[]>,
    private store: MessageStore,
  ) {}

  async start(): Promise<void> {
    // No hay socket: si hay token asumimos conectado (el handshake real lo hace Meta).
    this.status = this.config.accessToken ? 'connected' : 'disconnected';
  }

  async stop(): Promise<void> {
    this.status = 'disconnected';
  }

  getStatus(): string {
    return this.status;
  }

  /** Meta no usa QR. */
  getQrCode(): string | null {
    return null;
  }

  /** True si la línea IG usa la "Instagram Login API" (token IGAA → graph.instagram.com). */
  private get isIgLogin(): boolean {
    return this.channel === 'instagram' && /^IG/i.test(this.config.accessToken || '');
  }

  /** Base de Graph API según el tipo de token (FB Page vs Instagram Login). */
  private get base(): string {
    return this.isIgLogin ? GRAPH_IG : GRAPH_BASE;
  }

  /** Envía un mensaje de texto al usuario (PSID/IGSID) y lo persiste como OUTBOUND. */
  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.config.accessToken) {
      logger.warn(`[MetaClient:${this.accountId}] sin accessToken, no se puede enviar a ${to}`);
      return;
    }
    if (!text) return;

    try {
      // Facebook (Page token) usa /me/messages. Instagram con Instagram Login API
      // requiere /{ig-id}/messages; usamos externalId si está. Para IG vinculado
      // vía Facebook Login (Page token), /me/messages también funciona, pero
      // /{ig-id}/messages es válido en ambos casos cuando hay externalId.
      // Instagram Login (IGAA): graph.instagram.com/me/messages.
      // Facebook / IG vía Page token: graph.facebook.com con /{ig-id}/messages o /me/messages.
      const path = this.isIgLogin
        ? '/me/messages'
        : (this.channel === 'instagram' && this.config.externalId
            ? `/${encodeURIComponent(this.config.externalId)}/messages`
            : '/me/messages');

      await withRetry(
        () => axios.post(
          `${this.base}${path}?access_token=${encodeURIComponent(this.config.accessToken)}`,
          { recipient: { id: to }, message: { text } },
        ),
        { label: `MetaClient:${this.accountId} sendMessage` },
      );

      await this.store.record({
        accountId: this.accountId,
        phone: to,
        direction: 'OUTBOUND',
        content: text,
        messageType: 'text',
      });
    } catch (err: any) {
      await this.handleSendError(err, `al enviar a ${to}`);
    }
  }

  /**
   * Maneja errores de envío. Si es de auth (HTTP 401 o code 190 = Page token
   * vencido/inválido), marca la línea DESCONECTADA en la DB (P0) para que el
   * panel no la muestre verde con el bot mudo. Otros errores solo se loguean.
   */
  private async handleSendError(err: any, ctx: string): Promise<void> {
    const e = err?.response?.data?.error;
    const http = err?.response?.status;
    logger.error(`[MetaClient:${this.accountId}] error ${ctx}: ${e ? JSON.stringify(e) : err?.message ?? err}`);
    if (http === 401 || e?.code === 190) {
      this.status = 'disconnected';
      try {
        await supabase.from('accounts').update({ status: 'disconnected' }).eq('id', this.accountId);
        logger.warn(`[MetaClient:${this.accountId}] token inválido/vencido (code ${e?.code ?? http}) → línea marcada DESCONECTADA`);
      } catch (e2: any) {
        logger.warn(`[MetaClient:${this.accountId}] no pude persistir disconnected: ${e2?.message ?? e2}`);
      }
    }
  }

  /**
   * Resuelve el nombre real del perfil (Messenger PSID / Instagram IGSID) vía
   * Graph API y lo cachea. Meta NO incluye el nombre en el webhook (solo el id),
   * por eso el inbox mostraba números. Requiere que el token tenga permisos de
   * mensajería. Si falla (token inválido/sin permiso), cae al id como fallback.
   */
  private async resolveProfileName(psid: string): Promise<string> {
    const cached = this.profileNames.get(psid);
    if (cached) return cached;
    if (!this.config.accessToken) return psid;
    try {
      // Messenger devuelve first_name/last_name (NO 'name'); Instagram devuelve name/username.
      const fields = this.channel === 'instagram' ? 'name,username' : 'first_name,last_name';
      const { data } = await axios.get(`${this.base}/${encodeURIComponent(psid)}`, {
        params: { fields, access_token: this.config.accessToken },
        timeout: 8000,
      });
      const name = this.channel === 'instagram'
        ? (data?.name || data?.username)
        : ([data?.first_name, data?.last_name].filter(Boolean).join(' ') || data?.name);
      if (name) {
        this.profileNames.set(psid, name);
        return name;
      }
    } catch (err: any) {
      logger.info(`[MetaClient:${this.accountId}] no pude resolver nombre de ${psid}: ${err?.response?.data?.error?.message ?? err?.message ?? err}`);
    }
    return psid;
  }

  /**
   * Procesa un `entry` del webhook de Meta. Extrae los items inbound de texto,
   * los persiste como INBOUND, los enruta por `onMessage` y devuelve las
   * respuestas vía `sendMessage`. Robusto ante echoes / eventos sin texto.
   */
  async handleEvent(entry: any): Promise<void> {
    const inbound = MetaClient.extractInbound(entry);
    for (const { senderId, text, mid } of inbound) {
      // Idempotencia: Meta reintenta webhooks; no reprocesar el mismo mensaje.
      if (!(await claimWebhookMessage(mid))) {
        logger.info(`[MetaClient:${this.accountId}] mensaje duplicado ${mid} descartado`);
        continue;
      }
      try {
        const pushName = await this.resolveProfileName(senderId);
        await this.store.record({
          accountId: this.accountId,
          phone: senderId,
          direction: 'INBOUND',
          content: text,
          contactName: pushName,
          waMessageId: mid,
        });

        const responses = await this.onMessage(this.accountId, senderId, text, pushName, {});
        for (const response of responses ?? []) {
          const msg = MetaClient.coerceText(response);
          if (msg) await this.sendMessage(senderId, msg);
        }
      } catch (err: any) {
        logger.error(`[MetaClient:${this.accountId}] error procesando inbound de ${senderId}: ${err?.message ?? err}`);
      }
    }
  }

  /** Coacciona la respuesta del motor (string | {text} | {message}) a string. */
  static coerceText(response: any): string {
    if (response == null) return '';
    if (typeof response === 'string') return response;
    if (typeof response === 'object') {
      if (typeof response.text === 'string') return response.text;
      if (typeof response.message === 'string') return response.message;
    }
    return '';
  }

  /**
   * Extrae los pares {senderId, text} de texto inbound de un `entry` de Meta.
   * Soporta el shape de Messenger (`entry.messaging`) y el de IG
   * (`entry.messaging` o `entry.changes[].value`). Ignora echoes
   * (`message.is_echo`) y eventos sin mensaje/texto.
   */
  static extractInbound(entry: any): Array<{ senderId: string; text: string; mid?: string }> {
    const out: Array<{ senderId: string; text: string; mid?: string }> = [];
    if (!entry || typeof entry !== 'object') return out;

    const items: any[] = [];
    if (Array.isArray(entry.messaging)) items.push(...entry.messaging);
    // IG en formato "changes": cada change.value puede traer un messaging item.
    if (Array.isArray(entry.changes)) {
      for (const change of entry.changes) {
        const value = change?.value;
        if (!value) continue;
        if (Array.isArray(value.messaging)) items.push(...value.messaging);
        else if (value.sender || value.message) items.push(value);
      }
    }

    for (const item of items) {
      const message = item?.message;
      if (!message) continue;            // postbacks, reads, deliveries, etc.
      if (message.is_echo) continue;     // mensajes enviados por nosotros
      const text = message.text;
      if (typeof text !== 'string' || !text) continue; // adjuntos sin texto, stickers, etc.

      const senderId = item?.sender?.id;
      if (!senderId) continue;

      const mid = message.mid ? String(message.mid) : undefined;
      out.push({ senderId: String(senderId), text, mid });
    }

    return out;
  }
}

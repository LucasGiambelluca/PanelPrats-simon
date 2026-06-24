import axios from 'axios';
import { logger } from '../../utils/logger';
import type { MessageStore } from '../../services/MessageStore';
import type { ChannelClient } from '../../core/channels/ChannelClient';
import { claimWebhookMessage } from '../../services/idempotency';
import { withRetry } from '../../utils/retry';

const GRAPH_VERSION = 'v21.0';
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`;

export interface WhatsAppOfficialConfig {
  phone_number_id: string; // ID de teléfono de Meta
  accessToken: string;     // Token de acceso de Meta / WABA
  waba_id: string;         // ID de cuenta comercial de WhatsApp (opcional)
}

export class WhatsAppOfficialClient implements ChannelClient {
  private status: 'connected' | 'disconnected' = 'disconnected';

  constructor(
    private accountId: string,
    private config: WhatsAppOfficialConfig,
    private onMessage: (accountId: string, phone: string, text: string, pushName: string, fileCtx: any) => Promise<any[]>,
    private store: MessageStore,
  ) {}

  async start(): Promise<void> {
    this.status = this.config.accessToken && this.config.phone_number_id ? 'connected' : 'disconnected';
    logger.info(`[WhatsAppOfficialClient:${this.accountId}] Iniciado en estado: ${this.status}`);
  }

  async stop(): Promise<void> {
    this.status = 'disconnected';
  }

  getStatus(): string {
    return this.status;
  }

  async sendMessage(to: string, text: string): Promise<void> {
    if (!this.config.accessToken || !this.config.phone_number_id) {
      logger.warn(`[WhatsAppOfficialClient:${this.accountId}] Falta accessToken o phone_number_id, no se puede enviar mensaje.`);
      return;
    }
    if (!text) return;

    // Quitar formato @s.whatsapp.net si existiese
    const cleanPhone = to.replace('@s.whatsapp.net', '');

    try {
      await withRetry(
        () => axios.post(
          `${GRAPH_BASE}/${this.config.phone_number_id}/messages`,
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanPhone,
            type: 'text',
            text: { body: text },
          },
          {
            headers: {
              Authorization: `Bearer ${this.config.accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        ),
        { label: `WhatsAppOfficialClient:${this.accountId} sendMessage` },
      );

      await this.store.record({
        accountId: this.accountId,
        phone: cleanPhone,
        direction: 'OUTBOUND',
        content: text,
        messageType: 'text',
      });
    } catch (err: any) {
      logger.error(`[WhatsAppOfficialClient:${this.accountId}] Error enviando mensaje a ${cleanPhone}: ${err?.response?.data ? JSON.stringify(err.response.data) : err?.message ?? err}`);
    }
  }

  async handleWebhookEvent(value: any): Promise<void> {
    const contacts = value?.contacts || [];
    const messages = value?.messages || [];

    for (const msg of messages) {
      const { routingText, displayText } = WhatsAppOfficialClient.parseIncoming(msg);
      // Acepta texto y respuestas de botón/lista interactivas; ignora el resto.
      if (!routingText && !displayText) continue;

      // Idempotencia: Meta reintenta webhooks; no reprocesar el mismo mensaje.
      if (!(await claimWebhookMessage(msg.id))) {
        logger.info(`[WhatsAppOfficialClient:${this.accountId}] mensaje duplicado ${msg.id} descartado`);
        continue;
      }

      const from = msg.from;
      const contact = contacts.find((c: any) => c.wa_id === from);
      const pushName = contact?.profile?.name || from;

      try {
        await this.store.record({
          accountId: this.accountId,
          phone: from,
          direction: 'INBOUND',
          content: displayText,
          contactName: pushName,
          waMessageId: msg.id,
        });

        // routingText = id del botón/fila (número) para que el pollNode lo resuelva
        // al option-{idx} correcto; para texto plano es el cuerpo del mensaje.
        const responses = await this.onMessage(this.accountId, from, routingText, pushName, {});
        for (const response of responses ?? []) {
          await this.sendResponse(from, response);
        }
      } catch (err: any) {
        logger.error(`[WhatsAppOfficialClient:${this.accountId}] Error al procesar webhook de entrada para ${from}: ${err?.message ?? err}`);
      }
    }
  }

  /**
   * Normaliza un mensaje entrante de Cloud API a:
   *  - routingText: lo que consume el motor (id de la opción para botón/lista, o el texto).
   *  - displayText: lo que se guarda/muestra en el inbox (título de la opción o el texto).
   */
  static parseIncoming(msg: any): { routingText: string; displayText: string } {
    if (msg?.type === 'interactive') {
      const i = msg.interactive || {};
      const reply = i.button_reply || i.list_reply || {};
      const id = reply.id ?? '';
      const title = reply.title ?? '';
      return { routingText: String(id || title), displayText: String(title || id) };
    }
    // Botón de plantilla (quick reply) llega como type 'button'.
    if (msg?.type === 'button') {
      const payload = msg.button?.payload ?? msg.button?.text ?? '';
      return { routingText: String(payload), displayText: String(msg.button?.text ?? payload) };
    }
    const body = msg?.text?.body ?? '';
    return { routingText: String(body), displayText: String(body) };
  }

  /** Envía una respuesta del motor: interactiva (botones/lista) o texto. */
  private async sendResponse(to: string, response: any): Promise<void> {
    if (response && typeof response === 'object' && response.interactive) {
      await this.sendInteractive(to, response.interactive);
      return;
    }
    const msgText = WhatsAppOfficialClient.coerceText(response);
    if (msgText) await this.sendMessage(to, msgText);
  }

  /** Envía un mensaje interactivo (botones ≤3 / lista ≤10) por Cloud API. */
  async sendInteractive(to: string, interactive: any): Promise<void> {
    if (!this.config.accessToken || !this.config.phone_number_id) {
      logger.warn(`[WhatsAppOfficialClient:${this.accountId}] Falta accessToken o phone_number_id, no se puede enviar interactivo.`);
      return;
    }
    if (!interactive) return;
    const cleanPhone = to.replace('@s.whatsapp.net', '');

    try {
      await withRetry(
        () => axios.post(
          `${GRAPH_BASE}/${this.config.phone_number_id}/messages`,
          {
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanPhone,
            type: 'interactive',
            interactive,
          },
          {
            headers: {
              Authorization: `Bearer ${this.config.accessToken}`,
              'Content-Type': 'application/json',
            },
          }
        ),
        { label: `WhatsAppOfficialClient:${this.accountId} sendInteractive` },
      );

      const summary = interactive?.body?.text ? `[menú] ${interactive.body.text}` : '[menú interactivo]';
      await this.store.record({
        accountId: this.accountId,
        phone: cleanPhone,
        direction: 'OUTBOUND',
        content: summary,
        messageType: 'interactive',
      });
    } catch (err: any) {
      logger.error(`[WhatsAppOfficialClient:${this.accountId}] Error enviando interactivo a ${cleanPhone}: ${err?.response?.data ? JSON.stringify(err.response.data) : err?.message ?? err}`);
    }
  }

  static coerceText(response: any): string {
    if (response == null) return '';
    if (typeof response === 'string') return response;
    if (typeof response === 'object') {
      if (typeof response.text === 'string') return response.text;
      if (typeof response.message === 'string') return response.message;
    }
    return '';
  }
}

import axios from 'axios';
import { logger } from '../../utils/logger';
import type { MessageStore } from '../../services/MessageStore';
import type { ChannelClient } from '../../core/channels/ChannelClient';

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
      await axios.post(
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
      if (msg.type !== 'text' && !msg.text?.body) continue;

      const from = msg.from;
      const text = msg.text?.body;
      const contact = contacts.find((c: any) => c.wa_id === from);
      const pushName = contact?.profile?.name || from;

      try {
        await this.store.record({
          accountId: this.accountId,
          phone: from,
          direction: 'INBOUND',
          content: text,
          contactName: pushName,
        });

        const responses = await this.onMessage(this.accountId, from, text, pushName, {});
        for (const response of responses ?? []) {
          const msgText = WhatsAppOfficialClient.coerceText(response);
          if (msgText) await this.sendMessage(from, msgText);
        }
      } catch (err: any) {
        logger.error(`[WhatsAppOfficialClient:${this.accountId}] Error al procesar webhook de entrada para ${from}: ${err?.message ?? err}`);
      }
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

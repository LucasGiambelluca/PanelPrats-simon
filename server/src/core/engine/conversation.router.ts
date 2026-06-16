import { FlowEngine } from './flow.engine';
import { supabase } from '../../config/supabase';

const CANCEL_WORDS = ['cancelar', 'salir', 'chau', 'reset', 'reiniciar'];
const GREETING_WORDS = ['hola', 'menu', 'menú', 'inicio'];
const GLOBAL_BREAKERS = ['hola', 'menu', 'menú', 'cancelar', 'salir', 'reset', 'reiniciar', 'inicio'];

function norm(t: string): string {
  return (t || '').trim().toLowerCase();
}

export class ConversationRouter {
  constructor(private engine: FlowEngine) {}

  /** Devuelve los mensajes a enviar (strings/objetos). */
  async processMessage(accountId: string, phone: string, text: string, pushName: string, fileCtx: any = {}): Promise<any[]> {
    const t = norm(text);
    const baseCtx = { accountId, phone, pushName, user_message: text, ...fileCtx };

    // P0 — cancelar explícito
    if (CANCEL_WORDS.includes(t)) {
      await this.engine.forceReset(accountId, phone);
      return ['Listo, reiniciamos. Escribí *hola* para empezar de nuevo. 👋'];
    }

    // Handover — si la conversación está tomada por humano, el bot calla (salvo reanudar)
    const status = await this.getConversationStatus(accountId, phone);
    if (status === 'HANDOVER' && !GREETING_WORDS.includes(t)) {
      return [];
    }

    // Al motor con el texto REAL: el matching de trigger (exacto/parcial/wildcard)
    // resuelve qué flujo corre. No reescribir saludos a 'hola' — eso hacía que
    // "Menu" (u otros triggers) nunca llegaran a su flujo y cayeran siempre al wildcard.
    const result = await this.engine.processMessage(accountId, phone, text, baseCtx);
    const template = result?.currentStateDefinition?.message_template;
    if (Array.isArray(template)) return template;
    if (typeof template === 'string') return [template];
    return [];
  }

  private async getConversationStatus(accountId: string, phone: string): Promise<string | null> {
    try {
      const { data } = await supabase
        .from('whatsapp_conversations')
        .select('status')
        .eq('account_id', accountId)
        .eq('phone', phone)
        .maybeSingle();
      return (data?.status as string) ?? null;
    } catch (e: any) {
      console.warn(`[ConversationRouter] error fetching conversation status for phone ${phone}:`, e?.message || e);
      return null;
    }
  }
}

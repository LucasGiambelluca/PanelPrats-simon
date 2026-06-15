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

    // Saludo → forzar palabra 'hola' para que matchee el flujo de menú
    if (GREETING_WORDS.includes(t)) {
      return await this.engine.processMessage(accountId, phone, 'hola', baseCtx);
    }

    // Si hay sesión esperando input y NO es un breaker global → al motor tal cual
    // Default → al motor (resuelve por trigger / wildcard)
    return await this.engine.processMessage(accountId, phone, text, baseCtx);
  }

  private async getConversationStatus(accountId: string, phone: string): Promise<string | null> {
    const { data } = await supabase
      .from('whatsapp_conversations')
      .select('status')
      .eq('account_id', accountId)
      .eq('phone', phone)
      .maybeSingle();
    return (data?.status as string) ?? null;
  }
}

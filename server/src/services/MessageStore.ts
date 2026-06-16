import { supabase } from '../config/supabase';

export interface StoredMessage {
  accountId: string;
  phone: string;
  contactName?: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  messageType?: string;
  mediaUrl?: string;
  waMessageId?: string;
}

export class MessageStore {
  /** Upsert de la conversación (por account_id+phone) y devuelve su id. */
  async upsertConversation(accountId: string, phone: string, contactName: string | undefined, lastMessage: string): Promise<string> {
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .upsert(
        { account_id: accountId, phone, contact_name: contactName, last_message: lastMessage, last_message_at: new Date().toISOString() },
        { onConflict: 'account_id,phone' }
      )
      .select('id')
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  /** Inserta un mensaje en la conversación. */
  async insertMessage(conversationId: string, msg: StoredMessage): Promise<void> {
    const { error } = await supabase.from('whatsapp_messages').insert({
      conversation_id: conversationId,
      account_id: msg.accountId,   // denormalizado: historial por cuenta + filtro Realtime
      phone: msg.phone,            // denormalizado: getHistory filtra por (account_id, phone)
      direction: msg.direction,
      content: msg.content,
      media_url: msg.mediaUrl ?? null,
      message_type: msg.messageType ?? 'text',
      wa_message_id: msg.waMessageId ?? null,
    });
    if (error) throw error;
  }

  /** Timestamp del último mensaje ENTRANTE de un contacto (para la ventana de 24h). */
  async getLastInboundAt(accountId: string, phone: string): Promise<Date | null> {
    try {
      const { data } = await supabase
        .from('whatsapp_messages')
        .select('timestamp')
        .eq('account_id', accountId)
        .eq('phone', phone)
        .eq('direction', 'INBOUND')
        .order('timestamp', { ascending: false })
        .limit(1)
        .maybeSingle();
      return data?.timestamp ? new Date(data.timestamp as string) : null;
    } catch (err: any) {
      console.warn(`[MessageStore] getLastInboundAt error (${accountId}/${phone}):`, err?.message ?? err);
      return null;
    }
  }

  /** Atajo: upsert conversación + insert mensaje. */
  async record(msg: StoredMessage): Promise<void> {
    try {
      const convId = await this.upsertConversation(msg.accountId, msg.phone, msg.contactName, msg.content);
      await this.insertMessage(convId, msg);
    } catch (err: any) {
      console.warn(`[MessageStore] Warning: Failed to record message in database for account ${msg.accountId}:`, err?.message ?? err);
    }
  }
}

export const messageStore = new MessageStore();

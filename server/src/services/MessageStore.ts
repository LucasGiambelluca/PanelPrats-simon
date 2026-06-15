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

  /** Atajo: upsert conversación + insert mensaje. */
  async record(msg: StoredMessage): Promise<void> {
    const convId = await this.upsertConversation(msg.accountId, msg.phone, msg.contactName, msg.content);
    await this.insertMessage(convId, msg);
  }
}

export const messageStore = new MessageStore();

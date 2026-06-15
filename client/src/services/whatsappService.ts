import { supabase } from '../supabaseClient';
import { api } from '../lib/api';
import type { WhatsAppConversation, WhatsAppMessage } from '../types';

export async function loadConversations(accountId: string): Promise<WhatsAppConversation[]> {
  const { data } = await supabase
    .from('whatsapp_conversations')
    .select('*')
    .eq('account_id', accountId)
    .order('last_message_at', { ascending: false });
  return (data as WhatsAppConversation[]) || [];
}

export async function getMessages(conversationId: string): Promise<WhatsAppMessage[]> {
  const { data } = await supabase
    .from('whatsapp_messages')
    .select('*')
    .eq('conversation_id', conversationId)
    .order('timestamp', { ascending: true });
  return (data as WhatsAppMessage[]) || [];
}

export async function sendWhatsAppMessage(accountId: string, phone: string, text: string): Promise<void> {
  await api('/api/messages/send', {
    method: 'POST',
    body: JSON.stringify({ account_id: accountId, phone, text }),
  });
}

export async function setHandover(conversationId: string, resume: boolean): Promise<void> {
  await api(`/api/conversations/${conversationId}/handover`, {
    method: 'POST',
    body: JSON.stringify({ resume }),
  });
}

/** Realtime: notifica nuevos mensajes y cambios de conversación de una cuenta. */
export function subscribeToInbox(accountId: string, onChange: () => void) {
  const channel = supabase
    .channel(`inbox-${accountId}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'whatsapp_messages', filter: `account_id=eq.${accountId}` },
      onChange
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'whatsapp_conversations', filter: `account_id=eq.${accountId}` },
      onChange
    )
    .subscribe();
  return () => {
    supabase.removeChannel(channel);
  };
}

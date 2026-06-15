import { useEffect, useState, useCallback } from 'react';
import { useAccounts } from '../context/AccountContext';
import {
  loadConversations,
  getMessages,
  sendWhatsAppMessage,
  setHandover,
  subscribeToInbox,
} from '../services/whatsappService';
import type { WhatsAppConversation, WhatsAppMessage } from '../types';

export function useWhatsAppInbox() {
  const { activeAccountId } = useAccounts();
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<WhatsAppConversation | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [draft, setDraft] = useState('');

  const refreshConversations = useCallback(async () => {
    if (!activeAccountId) {
      setConversations([]);
      return;
    }
    setConversations(await loadConversations(activeAccountId));
  }, [activeAccountId]);

  useEffect(() => {
    refreshConversations();
  }, [refreshConversations]);

  useEffect(() => {
    if (!activeAccountId) return;
    const unsub = subscribeToInbox(activeAccountId, () => {
      refreshConversations();
      if (activeConvo) getMessages(activeConvo.id).then(setMessages);
    });
    return unsub;
  }, [activeAccountId, activeConvo, refreshConversations]);

  const selectConversation = useCallback(async (c: WhatsAppConversation) => {
    setActiveConvo(c);
    setMessages(await getMessages(c.id));
  }, []);

  const send = useCallback(async () => {
    if (!activeConvo || !draft.trim() || !activeAccountId) return;
    await sendWhatsAppMessage(activeAccountId, activeConvo.phone, draft.trim());
    setDraft('');
    setMessages(await getMessages(activeConvo.id));
  }, [activeConvo, draft, activeAccountId]);

  const toggleHandover = useCallback(async () => {
    if (!activeConvo) return;
    // resume=true devuelve la conversación al bot (estaba en HANDOVER)
    await setHandover(activeConvo.id, activeConvo.status === 'HANDOVER');
    setActiveConvo((cur) =>
      cur ? { ...cur, status: cur.status === 'HANDOVER' ? 'BOT' : 'HANDOVER' } : cur
    );
    await refreshConversations();
  }, [activeConvo, refreshConversations]);

  return {
    conversations,
    activeConvo,
    messages,
    draft,
    setDraft,
    selectConversation,
    send,
    toggleHandover,
  };
}

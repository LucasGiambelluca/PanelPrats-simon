import { useEffect, useState, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, UserCheck, Bot, Search, RefreshCw,
  Phone, Clock
} from 'lucide-react';
import { useAccounts } from '../context/AccountContext';
import { conversationsApi, messagesApi } from '../lib/api';
import { toast } from 'sonner';
import type { WhatsAppConversation, WhatsAppMessage } from '../types';

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(ts: string) {
  const d = new Date(ts);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (d.toDateString() === today.toDateString()) return 'Hoy';
  if (d.toDateString() === yesterday.toDateString()) return 'Ayer';
  return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

function getInitials(name: string) {
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

// Group messages by date for separator display
function groupByDate(messages: WhatsAppMessage[]) {
  const groups: { date: string; messages: WhatsAppMessage[] }[] = [];
  let currentDate = '';
  for (const m of messages) {
    const date = new Date(m.timestamp).toDateString();
    if (date !== currentDate) {
      currentDate = date;
      groups.push({ date: m.timestamp, messages: [m] });
    } else {
      groups[groups.length - 1].messages.push(m);
    }
  }
  return groups;
}

export default function WhatsAppInbox() {
  const { activeAccountId, accounts } = useAccounts();
  const activeAccount = accounts.find(a => a.id === activeAccountId);
  const [conversations, setConversations] = useState<WhatsAppConversation[]>([]);
  const [activeConvo, setActiveConvo] = useState<WhatsAppConversation | null>(null);
  const [messages, setMessages] = useState<WhatsAppMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [search, setSearch] = useState('');
  const [loadingConvos, setLoadingConvos] = useState(false);
  const [loadingMsgs, setLoadingMsgs] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollConvoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollMsgRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load conversations
  const loadConversations = useCallback(async () => {
    if (!activeAccountId) return;
    try {
      const data = await conversationsApi.list(activeAccountId);
      setConversations(data);
      // Update active convo status if it changed
      if (activeConvo) {
        const updated = data.find(c => c.id === activeConvo.id);
        if (updated) setActiveConvo(updated);
      }
    } catch (err) {
      // silent fail for polling
    }
  }, [activeAccountId, activeConvo]);

  useEffect(() => {
    setLoadingConvos(true);
    loadConversations().then(() => setLoadingConvos(false));
    if (pollConvoRef.current) clearInterval(pollConvoRef.current);
    pollConvoRef.current = setInterval(loadConversations, 5000);
    return () => { if (pollConvoRef.current) clearInterval(pollConvoRef.current); };
  }, [activeAccountId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load messages for active convo
  const loadMessages = useCallback(async (showLoader = false) => {
    if (!activeConvo) return;
    if (showLoader) setLoadingMsgs(true);
    try {
      const data = await conversationsApi.messages(activeConvo.id);
      setMessages(data);
    } catch (err) {
      // silent fail for polling
    }
    if (showLoader) setLoadingMsgs(false);
  }, [activeConvo]);

  useEffect(() => {
    if (activeConvo) {
      loadMessages(true);
      if (pollMsgRef.current) clearInterval(pollMsgRef.current);
      pollMsgRef.current = setInterval(() => loadMessages(false), 3000);
    } else {
      setMessages([]);
    }
    return () => { if (pollMsgRef.current) clearInterval(pollMsgRef.current); };
  }, [activeConvo?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const selectConversation = (c: WhatsAppConversation) => {
    setActiveConvo(c);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const send = async () => {
    if (!activeConvo || !draft.trim() || !activeAccountId || sending) return;
    const text = draft;
    setSending(true);
    setDraft('');

    // Optimistic: add the message locally
    const optimistic: WhatsAppMessage = {
      id: `opt-${Date.now()}`,
      conversation_id: activeConvo.id,
      direction: 'OUTBOUND',
      content: text,
      media_url: null,
      message_type: 'text',
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      await messagesApi.send(activeAccountId, activeConvo.phone, text);
      // Reload real messages after a beat
      setTimeout(() => loadMessages(false), 800);
    } catch (err: any) {
      toast.error('Error al enviar: ' + (err.message || 'desconocido'));
      // Remove optimistic message
      setMessages(prev => prev.filter(m => m.id !== optimistic.id));
      setDraft(text);
    }
    setSending(false);
    inputRef.current?.focus();
  };

  const toggleHandover = async () => {
    if (!activeConvo) return;
    const resume = activeConvo.status === 'HANDOVER';
    try {
      const res = await conversationsApi.handover(activeConvo.id, resume);
      setActiveConvo({ ...activeConvo, status: res.status as 'BOT' | 'HANDOVER' });
      toast.success(resume ? 'Bot reactivado' : 'Conversación tomada');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const filtered = search
    ? conversations.filter(c => (c.contact_name || c.phone).toLowerCase().includes(search.toLowerCase()))
    : conversations;

  const messageGroups = groupByDate(messages);
  const isAccountConnected = activeAccount?.status === 'connected';

  return (
    <div className="flex h-screen bg-[#0b0f1a]">
      {/* Conversation List */}
      <div className="w-[340px] border-r border-white/5 flex flex-col bg-[#111827]/50">
        {/* Header */}
        <div className="p-4 border-b border-white/5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-white text-lg flex items-center gap-2">
              <MessageSquare size={18} className="text-indigo-400" />
              Mensajes
            </h2>
            <div className="flex items-center gap-1.5">
              {activeAccount && (
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                  isAccountConnected
                    ? 'bg-emerald-500/10 text-emerald-400'
                    : 'bg-slate-500/10 text-slate-500'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isAccountConnected ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                  {isAccountConnected ? 'Online' : 'Offline'}
                </div>
              )}
              <button
                onClick={() => { setLoadingConvos(true); loadConversations().then(() => setLoadingConvos(false)); }}
                className="text-slate-500 hover:text-slate-300 transition-colors p-1.5 rounded-lg hover:bg-white/5"
              >
                <RefreshCw size={14} className={loadingConvos ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Buscar contacto o número…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white text-xs rounded-xl pl-9 pr-3 py-2.5 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
            />
          </div>
        </div>

        {/* Conversation List */}
        <div className="flex-1 overflow-y-auto">
          {filtered.map((c) => {
            const isActive = activeConvo?.id === c.id;
            return (
              <button
                key={c.id}
                onClick={() => selectConversation(c)}
                className={`w-full text-left px-4 py-3.5 transition-all duration-150 flex items-center gap-3 ${
                  isActive
                    ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500'
                    : 'hover:bg-white/[0.03] border-l-2 border-l-transparent'
                }`}
              >
                {/* Avatar */}
                <div className={`w-11 h-11 rounded-full flex items-center justify-center flex-shrink-0 ${
                  isActive
                    ? 'bg-indigo-500/20 border border-indigo-500/30'
                    : 'bg-white/5 border border-white/10'
                }`}>
                  <span className={`text-xs font-bold ${isActive ? 'text-indigo-400' : 'text-slate-400'}`}>
                    {getInitials(c.contact_name || c.phone.slice(-4))}
                  </span>
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-medium text-white text-sm truncate">
                      {c.contact_name || c.phone}
                    </span>
                    <span className="text-[10px] text-slate-600 whitespace-nowrap ml-2">
                      {c.last_message_at ? formatTime(c.last_message_at) : ''}
                    </span>
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-slate-500 truncate pr-2">{c.last_message || '…'}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {c.unread_count > 0 && (
                        <span className="bg-emerald-500 text-white text-[10px] font-bold min-w-[20px] h-5 rounded-full flex items-center justify-center px-1.5">
                          {c.unread_count}
                        </span>
                      )}
                      {c.status === 'HANDOVER' && (
                        <UserCheck size={12} className="text-rose-400" />
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {!loadingConvos && conversations.length === 0 && (
            <div className="text-center py-20 px-6">
              <MessageSquare size={36} className="text-slate-700 mx-auto mb-3" />
              <p className="text-slate-500 text-sm font-medium">Sin conversaciones</p>
              <p className="text-slate-600 text-xs mt-1">
                {isAccountConnected
                  ? 'Los mensajes aparecerán acá cuando alguien te escriba'
                  : 'Conectá un número primero desde "Mis Números"'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeConvo ? (
          <>
            {/* Chat Header */}
            <div className="px-6 py-3.5 border-b border-white/5 flex items-center justify-between bg-[#111827]/40 backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center">
                  <span className="text-indigo-400 font-bold text-sm">
                    {getInitials(activeConvo.contact_name || activeConvo.phone.slice(-4))}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm">{activeConvo.contact_name || activeConvo.phone}</h3>
                  <div className="flex items-center gap-2">
                    <Phone size={10} className="text-slate-600" />
                    <span className="text-[11px] text-slate-500 font-mono">{activeConvo.phone}</span>
                    {activeConvo.status === 'HANDOVER' && (
                      <span className="text-[9px] bg-rose-500/10 text-rose-400 border border-rose-500/20 rounded-full px-2 py-0.5 font-bold uppercase">
                        Humano
                      </span>
                    )}
                    {activeConvo.status === 'BOT' && (
                      <span className="text-[9px] bg-indigo-500/10 text-indigo-400 border border-indigo-500/20 rounded-full px-2 py-0.5 font-bold uppercase">
                        Bot
                      </span>
                    )}
                  </div>
                </div>
              </div>
              <button
                onClick={toggleHandover}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all duration-200 hover:-translate-y-0.5 ${
                  activeConvo.status === 'HANDOVER'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
                }`}
              >
                {activeConvo.status === 'HANDOVER' ? <Bot size={14} /> : <UserCheck size={14} />}
                {activeConvo.status === 'HANDOVER' ? 'Devolver al Bot' : 'Tomar Chat'}
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loadingMsgs && messages.length === 0 && (
                <div className="flex justify-center py-8">
                  <RefreshCw size={20} className="text-slate-600 animate-spin" />
                </div>
              )}

              {messageGroups.map((group, gi) => (
                <div key={gi}>
                  {/* Date separator */}
                  <div className="flex items-center justify-center my-4">
                    <span className="bg-white/5 text-slate-500 text-[10px] font-semibold px-3 py-1 rounded-full border border-white/5">
                      {formatDate(group.date)}
                    </span>
                  </div>

                  {/* Messages */}
                  <div className="space-y-1.5">
                    {group.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`flex ${m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}
                      >
                        <div
                          className={`max-w-[65%] px-4 py-2.5 text-sm relative group ${
                            m.direction === 'OUTBOUND'
                              ? 'bg-indigo-600 text-white rounded-2xl rounded-br-md shadow-md shadow-indigo-600/10'
                              : 'bg-white/[0.08] text-slate-200 rounded-2xl rounded-bl-md'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                          <div className={`flex items-center gap-1 mt-1 ${m.direction === 'OUTBOUND' ? 'justify-end' : ''}`}>
                            <Clock size={9} className={m.direction === 'OUTBOUND' ? 'text-indigo-300' : 'text-slate-600'} />
                            <span className={`text-[9px] ${m.direction === 'OUTBOUND' ? 'text-indigo-300' : 'text-slate-600'}`}>
                              {formatTime(m.timestamp)}
                            </span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              <div ref={messagesEndRef} />
            </div>

            {/* Message Input */}
            <div className="px-4 py-3 border-t border-white/5 bg-[#111827]/40">
              {!isAccountConnected && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2.5 mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-amber-400 flex-shrink-0" />
                  <p className="text-amber-400 text-xs">La cuenta no está conectada. Conectala desde "Mis Números" para enviar mensajes.</p>
                </div>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    className="w-full bg-white/5 border border-white/10 rounded-2xl pl-4 pr-12 py-3.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/40 focus:border-indigo-500/30 transition-all"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }}
                    placeholder={isAccountConnected ? 'Escribí un mensaje…' : 'Cuenta desconectada'}
                    disabled={!isAccountConnected}
                  />
                </div>
                <button
                  onClick={send}
                  disabled={!draft.trim() || sending || !isAccountConnected}
                  className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white p-3.5 rounded-2xl transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.95] disabled:opacity-30 disabled:hover:translate-y-0 shadow-lg shadow-indigo-600/20 flex-shrink-0"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          /* Empty State — No conversation selected */
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center max-w-xs">
              <div className="w-20 h-20 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mx-auto mb-5">
                <MessageSquare size={32} className="text-indigo-400/60" />
              </div>
              <h3 className="text-white font-semibold text-lg mb-2">Tu Inbox</h3>
              <p className="text-slate-500 text-sm leading-relaxed">
                {conversations.length > 0
                  ? 'Seleccioná una conversación de la izquierda para ver los mensajes'
                  : isAccountConnected
                    ? 'Cuando alguien te escriba al WhatsApp conectado, vas a ver la conversación acá'
                    : 'Conectá un número desde "Mis Números" para empezar a recibir mensajes'
                }
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

import { useEffect, useState, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, UserCheck, Bot, Search, RefreshCw,
  Phone, Clock, Facebook, Instagram, Layers, ArrowLeft
} from 'lucide-react';
import { useAccounts } from '../context/AccountContext';
import { conversationsApi, messagesApi } from '../lib/api';
import { toast } from 'sonner';
import type { WhatsAppConversation, WhatsAppMessage } from '../types';

type Channel = 'whatsapp' | 'facebook' | 'instagram';

const channelConfig = {
  whatsapp:  { label: 'WhatsApp',  icon: MessageSquare, color: 'text-emerald-600 bg-emerald-500/10 border-emerald-500/20' },
  facebook:  { label: 'Facebook',  icon: Facebook,      color: 'text-blue-600 bg-blue-500/10 border-blue-500/20' },
  instagram: { label: 'Instagram', icon: Instagram,     color: 'text-pink-600 bg-pink-500/10 border-pink-400/20' },
};

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
  const [allLines, setAllLines] = useState(true); // bandeja unificada por defecto (todas las líneas)
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const pollConvoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollMsgRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeConvoId = activeConvo?.id;

  // Load conversations
  const loadConversations = useCallback(async () => {
    try {
      let data: WhatsAppConversation[];
      if (allLines) {
        // Bandeja unificada: todas las líneas en una sola query (backend ya ordena por last_message_at).
        data = await conversationsApi.listAll();
      } else {
        if (!activeAccountId) return;
        data = await conversationsApi.list(activeAccountId);
      }
      setConversations(data);
      // Update active convo status if it changed
      if (activeConvoId) {
        const updated = data.find(c => c.id === activeConvoId);
        if (updated) setActiveConvo(updated);
      }
    } catch (err) {
      // silent fail for polling
    }
  }, [allLines, accounts, activeAccountId, activeConvoId]);

  useEffect(() => {
    setLoadingConvos(true);
    loadConversations().then(() => setLoadingConvos(false));
    if (pollConvoRef.current) clearInterval(pollConvoRef.current);
    pollConvoRef.current = setInterval(loadConversations, 5000);
    return () => { if (pollConvoRef.current) clearInterval(pollConvoRef.current); };
  }, [loadConversations]);

  // Load messages for active convo
  const loadMessages = useCallback(async (showLoader = false) => {
    if (!activeConvoId) return;
    if (showLoader) setLoadingMsgs(true);
    try {
      const data = await conversationsApi.messages(activeConvoId);
      setMessages(data);
    } catch (err) {
      // silent fail for polling
    }
    if (showLoader) setLoadingMsgs(false);
  }, [activeConvoId]);

  useEffect(() => {
    if (activeConvoId) {
      loadMessages(true);
      if (pollMsgRef.current) clearInterval(pollMsgRef.current);
      pollMsgRef.current = setInterval(() => loadMessages(false), 3000);
    } else {
      setMessages([]);
    }
    return () => { if (pollMsgRef.current) clearInterval(pollMsgRef.current); };
  }, [activeConvoId, loadMessages]);

  // Scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const selectConversation = (c: WhatsAppConversation) => {
    setActiveConvo(c);
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const send = async () => {
    const acctId = activeConvo?.account_id || activeAccountId;
    if (!activeConvo || !draft.trim() || !acctId || sending) return;
    if (activeConvo.phone.includes('@lid')) {
      toast.error('Este contacto no tiene un número de WhatsApp utilizable (privacidad). No se puede responder por acá.');
      return;
    }
    const text = draft;
    setSending(true);
    setDraft('');

    // Optimistic: add the message locally with a guaranteed unique ID
    const randomSuffix = Math.random().toString(36).substring(2, 9);
    const optimistic: WhatsAppMessage = {
      id: `opt-${Date.now()}-${randomSuffix}`,
      conversation_id: activeConvo.id,
      direction: 'OUTBOUND',
      content: text,
      media_url: null,
      message_type: 'text',
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, optimistic]);

    try {
      const res = await messagesApi.send(acctId, activeConvo.phone, text);
      if (res.resolved === false) {
        toast.warning('Este número no figura en WhatsApp; puede que el mensaje no se entregue.');
      }
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
    <div className="flex h-[calc(100dvh-3.5rem)] lg:h-screen bg-brand-ivory">
      {/* Conversation List — en móvil ocupa todo; se oculta al abrir un chat */}
      <div className={`w-full lg:w-[340px] border-r border-brand-hairline flex-col bg-brand-surface ${activeConvo ? 'hidden lg:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-4 border-b border-brand-hairline">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-bold text-brand-ink text-lg flex items-center gap-2">
              <MessageSquare size={18} className="text-brand-secondary" />
              Mensajes
            </h2>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setAllLines(v => !v)}
                title={allLines ? 'Mostrando todas las líneas' : 'Mostrar todas las líneas'}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                  allLines ? 'bg-brand-secondary/15 text-brand-secondary' : 'bg-black/[0.03] text-brand-inkmuted hover:text-brand-ink'
                }`}
              >
                <Layers size={11} /> {allLines ? 'Todas' : 'Esta línea'}
              </button>
              {!allLines && activeAccount && (
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold ${
                  isAccountConnected
                    ? 'bg-emerald-500/10 text-emerald-600'
                    : 'bg-slate-500/10 text-brand-inkmuted'
                }`}>
                  <div className={`w-1.5 h-1.5 rounded-full ${isAccountConnected ? 'bg-emerald-500' : 'bg-slate-400'}`} />
                  {isAccountConnected ? 'Online' : 'Offline'}
                </div>
              )}
              <button
                onClick={() => { setLoadingConvos(true); loadConversations().then(() => setLoadingConvos(false)); }}
                className="text-brand-inkmuted hover:text-brand-ink transition-colors p-1.5 rounded-lg hover:bg-black/[0.03]"
              >
                <RefreshCw size={14} className={loadingConvos ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Buscar contacto o número…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white border border-brand-hairline text-brand-ink text-xs rounded-xl pl-9 pr-3 py-2.5 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#24365a]/40 transition-all"
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
                    ? 'bg-[#24365a]/10 border-l-2 border-l-[#24365a]'
                    : 'hover:bg-black/[0.03] border-l-2 border-l-transparent'
                }`}
              >
                {/* Avatar with Channel Overlay */}
                <div className="relative flex-shrink-0">
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center ${
                    isActive
                      ? 'bg-[#24365a]/20 border border-[#24365a]/30'
                      : 'bg-black/[0.03] border border-brand-hairline'
                  }`}>
                    <span className={`text-xs font-bold ${isActive ? 'text-[#24365a]' : 'text-brand-inkmuted'}`}>
                      {getInitials(c.contact_name || c.phone.slice(-4))}
                    </span>
                  </div>
                  {/* Overlapping small channel icon */}
                  {(() => {
                    const convoAccount = accounts.find(a => a.id === c.account_id);
                    const ch = (convoAccount?.channel || activeAccount?.channel || 'whatsapp') as Channel;
                    const chCfg = channelConfig[ch] || channelConfig.whatsapp;
                    const ChIcon = chCfg.icon;
                    const chColor = ch === 'whatsapp' ? 'bg-emerald-500 text-white' : ch === 'facebook' ? 'bg-blue-600 text-white' : 'bg-pink-500 text-white';
                    return (
                      <div className={`absolute -bottom-1 -right-1 w-5 h-5 rounded-full ${chColor} flex items-center justify-center border border-brand-surface shadow-sm`}>
                        <ChIcon size={10} />
                      </div>
                    );
                  })()}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="font-medium text-brand-ink text-sm truncate">
                      {c.contact_name || c.phone}
                    </span>
                    <span className="text-[10px] text-brand-inkmuted whitespace-nowrap ml-2">
                      {c.last_message_at ? formatTime(c.last_message_at) : ''}
                    </span>
                  </div>
                  {allLines && (
                    <span className="inline-flex items-center gap-1 text-[9px] text-brand-secondary bg-brand-secondary/10 rounded px-1.5 py-0.5 mb-0.5">
                      <Layers size={9} /> {accounts.find(a => a.id === c.account_id)?.name || 'Línea'}
                    </span>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-brand-inkmuted truncate pr-2">{c.last_message || '…'}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      {c.unread_count > 0 && (
                        <span className="bg-emerald-500 text-white text-[10px] font-bold min-w-[20px] h-5 rounded-full flex items-center justify-center px-1.5">
                          {c.unread_count}
                        </span>
                      )}
                      {c.status === 'HANDOVER' && (
                        <UserCheck size={12} className="text-rose-600" />
                      )}
                    </div>
                  </div>
                </div>
              </button>
            );
          })}

          {!loadingConvos && conversations.length === 0 && (
            <div className="text-center py-20 px-6">
              <MessageSquare size={36} className="text-slate-300 mx-auto mb-3" />
              <p className="text-brand-inkmuted text-sm font-medium">Sin conversaciones</p>
              <p className="text-brand-inkmuted text-xs mt-1">
                {isAccountConnected
                  ? 'Los mensajes aparecerán acá cuando alguien te escriba'
                  : 'Conectá un número primero desde "Mis Números"'}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Chat Area */}
      <div className={`flex-1 flex-col ${activeConvo ? 'flex' : 'hidden lg:flex'}`}>
        {activeConvo ? (
          <>
            {/* Chat Header */}
            <div className="px-4 lg:px-6 py-3.5 border-b border-brand-hairline flex items-center justify-between bg-brand-surface backdrop-blur-sm">
              <div className="flex items-center gap-3">
                <button onClick={() => setActiveConvo(null)} aria-label="Volver" className="lg:hidden text-brand-inkmuted hover:text-brand-ink -ml-1 mr-1">
                  <ArrowLeft size={20} />
                </button>
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-[#1a2949]/30 to-[#101820]/30 border border-[#24365a]/20 flex items-center justify-center relative">
                  <span className="text-[#24365a] font-bold text-sm">
                    {getInitials(activeConvo.contact_name || activeConvo.phone.slice(-4))}
                  </span>
                  {/* Small overlapping channel icon in active chat header */}
                  {(() => {
                    const convoAccount = accounts.find(a => a.id === activeConvo.account_id) || activeAccount;
                    const ch = (convoAccount?.channel || 'whatsapp') as Channel;
                    const chCfg = channelConfig[ch] || channelConfig.whatsapp;
                    const ChIcon = chCfg.icon;
                    const chColor = ch === 'whatsapp' ? 'bg-emerald-500 text-white' : ch === 'facebook' ? 'bg-blue-600 text-white' : 'bg-pink-500 text-white';
                    return (
                      <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full ${chColor} flex items-center justify-center border border-brand-surface shadow-sm`}>
                        <ChIcon size={8} />
                      </div>
                    );
                  })()}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-brand-ink text-sm">{activeConvo.contact_name || activeConvo.phone}</h3>
                    {(() => {
                      const ch = (activeAccount?.channel || 'whatsapp') as Channel;
                      const chCfg = channelConfig[ch] || channelConfig.whatsapp;
                      const ChIcon = chCfg.icon;
                      return (
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${chCfg.color}`}>
                          <ChIcon size={10} />
                          {chCfg.label}
                        </span>
                      );
                    })()}
                  </div>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Phone size={10} className="text-slate-400" />
                    <span className="text-[11px] text-brand-inkmuted font-mono">{activeConvo.phone}</span>
                    {activeConvo.status === 'HANDOVER' && (
                      <span className="text-[9px] bg-rose-500/10 text-rose-600 border border-rose-500/20 rounded-full px-2 py-0.5 font-bold uppercase">
                        Humano
                      </span>
                    )}
                    {activeConvo.status === 'BOT' && (
                      <span className="text-[9px] bg-[#24365a]/10 text-[#24365a] border border-[#24365a]/20 rounded-full px-2 py-0.5 font-bold uppercase">
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
                    ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20'
                    : 'bg-[#24365a]/10 text-[#24365a] border-[#24365a]/20 hover:bg-[#24365a]/20'
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
                  <RefreshCw size={20} className="text-slate-400 animate-spin" />
                </div>
              )}

              {messageGroups.map((group) => (
                <div key={group.date}>
                  {/* Date separator */}
                  <div className="flex items-center justify-center my-4">
                    <span className="bg-black/[0.03] text-brand-inkmuted text-[10px] font-semibold px-3 py-1 rounded-full border border-brand-hairline">
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
                              ? 'bg-gradient-to-r from-[#1a2949] to-[#101820] text-white rounded-2xl rounded-br-md shadow-md shadow-[#1a2949]/10'
                              : 'bg-brand-panel border border-brand-hairline text-brand-ink rounded-2xl rounded-bl-md'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                          <div className={`flex items-center gap-1 mt-1 ${m.direction === 'OUTBOUND' ? 'justify-end' : ''}`}>
                            {m.direction === 'OUTBOUND' && m.id.startsWith('opt-') ? (
                              <>
                                <RefreshCw size={9} className="text-slate-300 animate-spin" />
                                <span className="text-[9px] text-slate-300">enviando…</span>
                              </>
                            ) : (
                              <>
                                <Clock size={9} className={m.direction === 'OUTBOUND' ? 'text-slate-300' : 'text-slate-600'} />
                                <span className={`text-[9px] ${m.direction === 'OUTBOUND' ? 'text-slate-300' : 'text-slate-600'}`}>
                                  {formatTime(m.timestamp)}
                                </span>
                              </>
                            )}
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
            <div className="px-4 py-3 border-t border-brand-hairline bg-brand-surface">
              {!isAccountConnected && (
                <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl px-4 py-2.5 mb-3 flex items-center gap-2">
                  <Clock size={14} className="text-amber-600 flex-shrink-0" />
                  <p className="text-amber-600 text-xs">La cuenta no está conectada. Conectala desde "Mis Números" para enviar mensajes.</p>
                </div>
              )}
              <div className="flex items-end gap-2">
                <div className="flex-1 relative">
                  <input
                    ref={inputRef}
                    className="w-full bg-white border border-brand-hairline rounded-2xl pl-4 pr-12 py-3.5 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#24365a]/40 focus:border-[#24365a]/30 transition-all"
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
                  className="bg-gradient-to-r from-[#1a2949] to-[#101820] hover:from-[#3a5264] hover:to-[#b88c6b] text-white p-3.5 rounded-2xl transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.95] disabled:opacity-30 disabled:hover:translate-y-0 shadow-lg shadow-[#1a2949]/20 flex-shrink-0"
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
              <div className="w-20 h-20 rounded-2xl bg-[#24365a]/10 border border-[#24365a]/20 flex items-center justify-center mx-auto mb-5">
                <MessageSquare size={32} className="text-[#24365a]/60" />
              </div>
              <h3 className="text-brand-ink font-semibold text-lg mb-2">Tu Inbox</h3>
              <p className="text-brand-inkmuted text-sm leading-relaxed">
                {conversations.length > 0
                  ? 'Seleccioná una conversación de la izquierda para ver los mensajes'
                  : isAccountConnected
                    ? 'Cuando alguien te escriba al canal conectado, vas a ver la conversación acá'
                    : 'Conectá un número o cuenta desde "Mis Números" para empezar a recibir mensajes'
                }
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

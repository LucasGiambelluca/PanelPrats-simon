import { useEffect, useState, useRef, useCallback } from 'react';
import {
  MessageSquare, Send, UserCheck, Bot, Search, RefreshCw, RotateCcw,
  Phone, Clock, Facebook, Instagram, Layers, ArrowLeft, Calendar, CalendarCheck,
  Check
} from 'lucide-react';
import { useSearchParams } from 'react-router-dom';
import { useAccounts } from '../context/AccountContext';
import { conversationsApi, messagesApi, appointmentsApi } from '../lib/api';
import { toast } from 'sonner';
import type { WhatsAppConversation, WhatsAppMessage } from '../types';
import BookFromChatModal from '../components/BookFromChatModal';

// Normaliza teléfono a sus últimos 10 dígitos (cubre el '9' de AR y separadores)
// para cruzar conversaciones con citas, donde el formato puede diferir.
function normPhone(p: string): string {
  return (p || '').replace(/\D/g, '').slice(-10);
}

// Badge de estado de agendado para una conversación.
function ApptBadge({ agendado }: { agendado: boolean }) {
  return agendado ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-emerald-500/10 text-emerald-600 border border-emerald-500/20">
      <CalendarCheck size={9} /> Agendado
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-brand-inkmuted/10 text-brand-inkmuted border border-brand-hairline">
      Sin agendar
    </span>
  );
}

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
  return (name || '').trim().split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase() || '?';
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
  const [loadError, setLoadError] = useState(false); // error en la carga de conversaciones
  const [bookOpen, setBookOpen] = useState(false); // modal de agendado manual desde el chat
  const [apptPhones, setApptPhones] = useState<Set<string>>(new Set()); // teléfonos con cita activa
  const [searchParams, setSearchParams] = useSearchParams();
  const deepLinkedRef = useRef(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 120)}px`;
    }
  }, []);

  useEffect(() => {
    adjustHeight();
  }, [draft, adjustHeight]);
  const pollConvoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollMsgRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const activeConvoId = activeConvo?.id;

  // Ref del convo activo: lo lee el poll de conversaciones SIN entrar como dependencia
  // del callback (si entrara, seleccionar un chat recrearía el callback y re-suscribiría
  // el intervalo, reseteando el spinner en cada selección).
  const activeConvoIdRef = useRef<string | undefined>(undefined);
  useEffect(() => { activeConvoIdRef.current = activeConvoId; }, [activeConvoId]);

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
      setLoadError(false);
      // Refrescar el convo activo SOLO si cambió algo relevante. Pisarlo con un objeto
      // nuevo en cada poll (cada 5s) re-renderiza y hace "saltar" el panel de mensajes.
      const id = activeConvoIdRef.current;
      if (id) {
        const updated = data.find(c => c.id === id);
        if (updated) {
          setActiveConvo(prev =>
            prev &&
            prev.status === updated.status &&
            prev.last_message === updated.last_message &&
            prev.last_message_at === updated.last_message_at
              ? prev
              : updated
          );
        }
      }
    } catch (err) {
      // Marcamos error: la UI lo muestra solo si no hay nada cargado (empty-state).
      setLoadError(true);
    }
  }, [allLines, activeAccountId]);

  useEffect(() => {
    setLoadingConvos(true);
    loadConversations().then(() => setLoadingConvos(false));
    if (pollConvoRef.current) clearInterval(pollConvoRef.current);
    pollConvoRef.current = setInterval(() => { if (!document.hidden) loadConversations(); }, 5000);
    return () => { if (pollConvoRef.current) clearInterval(pollConvoRef.current); };
  }, [loadConversations]);

  // Teléfonos con cita activa (no cancelada) → etiqueta "Agendado" / "Sin agendar".
  const loadApptPhones = useCallback(async () => {
    try {
      const scope = allLines ? 'all' : (activeAccountId || 'all');
      const appts = await appointmentsApi.list(scope);
      const set = new Set<string>();
      for (const a of appts) {
        if (a.status === 'cancelada') continue;
        const p = normPhone(a.phone || a.telefono || '');
        if (p) set.add(p);
      }
      setApptPhones(set);
    } catch { /* no romper el inbox por la etiqueta */ }
  }, [allLines, activeAccountId]);
  useEffect(() => { loadApptPhones(); }, [loadApptPhones]);

  const isAgendado = useCallback((phone: string) => apptPhones.has(normPhone(phone)), [apptPhones]);

  // Deep-link desde la Agenda: /inbox?account=&phone= → abre esa conversación.
  // Forzamos bandeja unificada para garantizar que la conversación esté cargada.
  useEffect(() => {
    if (searchParams.get('phone')) setAllLines(true);
    // sólo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    const ph = searchParams.get('phone');
    if (!ph || deepLinkedRef.current || conversations.length === 0) return;
    const acc = searchParams.get('account');
    const target = normPhone(ph);
    const match =
      conversations.find(c => normPhone(c.phone) === target && (!acc || c.account_id === acc)) ||
      conversations.find(c => normPhone(c.phone) === target);
    deepLinkedRef.current = true;
    if (match) {
      setActiveConvo(match);
      setTimeout(() => textareaRef.current?.focus(), 100);
    } else {
      toast.error('No hay conversación con este contacto');
    }
    setSearchParams({}, { replace: true });
  }, [conversations, searchParams, setSearchParams]);

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
      pollMsgRef.current = setInterval(() => { if (!document.hidden) loadMessages(false); }, 3000);
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
    setTimeout(() => textareaRef.current?.focus(), 100);
  };

  const send = async () => {
    const acctId = activeConvo?.account_id || activeAccountId;
    if (!activeConvo || !draft.trim() || !acctId || sending) return;
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
    textareaRef.current?.focus();
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

  const [resetting, setResetting] = useState(false);
  const resetConversation = async () => {
    if (!activeConvo || resetting) return;
    if (!window.confirm('¿Reiniciar la conversación? El bot se va a olvidar del contexto y arranca de cero. No borra los mensajes.')) return;
    setResetting(true);
    try {
      await conversationsApi.reset(activeConvo.id);
      setActiveConvo({ ...activeConvo, status: 'BOT' });
      toast.success('Bot reiniciado: se olvidó del contexto');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setResetting(false);
    }
  };

  const filtered = search
    ? conversations.filter(c => (c.contact_name || c.phone).toLowerCase().includes(search.toLowerCase()))
    : conversations;

  const messageGroups = groupByDate(messages);
  // En modo unificado el chat abierto puede ser de otra línea: la conexión se
  // evalúa contra la cuenta de la conversación, no la del selector.
  const convoAccount = activeConvo ? accounts.find(a => a.id === activeConvo.account_id) : activeAccount;
  const isAccountConnected = (convoAccount || activeAccount)?.status === 'connected';

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] overflow-hidden bg-brand-ivory">
      {/* Conversation List — en móvil ocupa todo; se oculta al abrir un chat */}
      <div className={`w-full lg:w-[340px] border-r border-brand-hairline flex-col bg-brand-surface ${activeConvo ? 'hidden lg:flex' : 'flex'}`}>
        {/* Header */}
        <div className="p-4 border-b border-brand-hairline">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-serif font-bold text-brand-ink text-lg flex items-center gap-2">
              <MessageSquare size={18} className="text-brand-primary" />
              Mensajes
            </h2>
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setAllLines(v => !v)}
                title={allLines ? 'Mostrando todas las líneas' : 'Mostrar todas las líneas'}
                className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-colors ${
                  allLines ? 'bg-brand-primary/[0.08] text-brand-primary' : 'bg-black/[0.03] text-brand-inkmuted hover:text-brand-ink'
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
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-brand-inkmuted" />
            <input
              type="text"
              placeholder="Buscar contacto o número…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white border border-brand-hairline text-brand-ink text-xs rounded-xl pl-9 pr-3 py-2.5 placeholder-brand-inkmuted focus:outline-none focus:ring-2 focus:ring-brand-primary/40 transition-all"
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
                    ? 'bg-brand-primary/[0.08] border-l-2 border-l-brand-primary'
                    : 'hover:bg-black/[0.03] border-l-2 border-l-transparent'
                }`}
              >
                {/* Avatar with Channel Overlay */}
                <div className="relative flex-shrink-0">
                  <div className={`w-11 h-11 rounded-full flex items-center justify-center ${
                    isActive
                      ? 'bg-brand-primary/[0.12] border border-brand-primary/30'
                      : 'bg-brand-primary/[0.06] border border-brand-hairline'
                  }`}>
                    <span className={`text-xs font-bold ${isActive ? 'text-brand-primary' : 'text-brand-primary/70'}`}>
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
                    <span className="inline-flex items-center gap-1 text-[9px] text-brand-primary bg-brand-primary/[0.08] rounded px-1.5 py-0.5 mb-0.5">
                      <Layers size={9} /> {accounts.find(a => a.id === c.account_id)?.name || 'Línea'}
                    </span>
                  )}
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] text-brand-inkmuted truncate pr-2">{c.last_message || '…'}</p>
                    <div className="flex items-center gap-1.5 flex-shrink-0">
                      <ApptBadge agendado={isAgendado(c.phone)} />
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
              <MessageSquare size={36} className="text-brand-primary/30 mx-auto mb-3" />
              <p className="text-brand-inkmuted text-sm font-medium">{loadError ? 'Error al cargar — reintentando…' : 'Sin conversaciones'}</p>
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
            <div className="px-4 lg:px-6 py-3.5 border-b border-brand-hairline flex items-center justify-between bg-brand-surface">
              <div className="flex items-center gap-3">
                <button onClick={() => setActiveConvo(null)} aria-label="Volver" className="lg:hidden text-brand-inkmuted hover:text-brand-ink -ml-1 mr-1">
                  <ArrowLeft size={20} />
                </button>
                <div className="w-10 h-10 rounded-full bg-brand-primary/[0.08] border border-brand-primary/20 flex items-center justify-center relative">
                  <span className="text-brand-primary font-bold text-sm">
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
                    <h3 className="font-serif font-bold text-brand-ink text-sm">{activeConvo.contact_name || activeConvo.phone}</h3>
                    {(() => {
                      const ch = (convoAccount?.channel || 'whatsapp') as Channel;
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
                    <Phone size={10} className="text-brand-inkmuted" />
                    <span className="text-[11px] text-brand-inkmuted font-mono">{activeConvo.phone}</span>
                    {activeConvo.status === 'HANDOVER' && (
                      <span className="text-[9px] bg-rose-500/10 text-rose-600 border border-rose-500/20 rounded-full px-2 py-0.5 font-bold uppercase">
                        Humano
                      </span>
                    )}
                    {activeConvo.status === 'BOT' && (
                      <span className="text-[9px] bg-brand-primary/[0.08] text-brand-primary border border-brand-primary/20 rounded-full px-2 py-0.5 font-bold uppercase">
                        Bot
                      </span>
                    )}
                    <ApptBadge agendado={isAgendado(activeConvo.phone)} />
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setBookOpen(true)}
                  title="Agendar una cita para este contacto"
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border border-brand-primary/20 bg-brand-primary/[0.08] text-brand-primary transition-all duration-200 hover:-translate-y-0.5 hover:bg-brand-primary/[0.14]"
                >
                  <Calendar size={14} />
                  Agendar
                </button>
                <button
                  onClick={resetConversation}
                  disabled={resetting}
                  title="Reiniciar: el bot se olvida del contexto y arranca de cero"
                  className="flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-semibold border border-amber-500/20 bg-amber-500/10 text-amber-600 transition-all duration-200 hover:-translate-y-0.5 hover:bg-amber-500/20 disabled:opacity-50 disabled:hover:translate-y-0"
                >
                  <RotateCcw size={14} className={resetting ? 'animate-spin' : ''} />
                  Reiniciar
                </button>
                <button
                  onClick={toggleHandover}
                  className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all duration-200 hover:-translate-y-0.5 ${
                    activeConvo.status === 'HANDOVER'
                      ? 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20 hover:bg-emerald-500/20'
                      : 'bg-brand-primary/[0.08] text-brand-primary border-brand-primary/20 hover:bg-brand-primary/[0.14]'
                  }`}
                >
                  {activeConvo.status === 'HANDOVER' ? <Bot size={14} /> : <UserCheck size={14} />}
                  {activeConvo.status === 'HANDOVER' ? 'Devolver al Bot' : 'Tomar Chat'}
                </button>
              </div>
            </div>

            {/* Modal de agendado manual desde el chat */}
            <BookFromChatModal
              open={bookOpen}
              onClose={() => setBookOpen(false)}
              accountId={activeConvo.account_id}
              phone={activeConvo.phone}
              contactName={activeConvo.contact_name || ''}
              onBooked={() => loadApptPhones()}
            />

            {/* Messages */}
            <div
              className="flex-1 overflow-y-auto px-6 py-4 relative"
              style={{ 
                backgroundColor: '#f4f3ef',
                backgroundImage: 'radial-gradient(rgba(204, 163, 120, 0.18) 0.8px, #f4f3ef 0.8px)', 
                backgroundSize: '20px 20px' 
              }}
            >
              {loadingMsgs && messages.length === 0 && (
                <div className="flex justify-center py-8">
                  <RefreshCw size={20} className="text-brand-inkmuted animate-spin" />
                </div>
              )}

              {messageGroups.map((group) => (
                <div key={group.date}>
                  {/* Date separator */}
                  <div className="flex items-center justify-center my-4">
                    <span className="bg-white/80 backdrop-blur-sm text-brand-inkmuted text-[10px] font-semibold px-3 py-1 rounded-full border border-brand-hairline shadow-sm">
                      {formatDate(group.date)}
                    </span>
                  </div>

                  {/* Messages */}
                  <div className="space-y-2">
                    {group.messages.map((m) => (
                      <div
                        key={m.id}
                        className={`flex ${m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'} animate-fade-in`}
                      >
                        <div
                          className={`max-w-[65%] px-4 py-2.5 text-sm relative group shadow-sm transition-all duration-150 hover:shadow-md ${
                            m.direction === 'OUTBOUND'
                              ? 'bg-gradient-to-r from-brand-primary to-brand-secondary text-white rounded-2xl rounded-tr-sm'
                              : 'bg-white border border-brand-hairline text-brand-ink rounded-2xl rounded-tl-sm'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words leading-relaxed">{m.content}</p>
                          <div className={`flex items-center justify-end gap-1.5 mt-1 text-[9px] ${
                            m.direction === 'OUTBOUND' ? 'text-white/60' : 'text-brand-inkmuted'
                          }`}>
                            <span>{formatTime(m.timestamp)}</span>
                            {m.direction === 'OUTBOUND' && (
                              m.id.startsWith('opt-') ? (
                                <RefreshCw size={9} className="animate-spin text-white/50" />
                              ) : (
                                <Check size={13} className="text-white/40" />
                              )
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
                  <textarea
                    ref={textareaRef}
                    rows={1}
                    className="w-full bg-white border border-brand-hairline rounded-2xl px-4 py-3 text-brand-ink text-sm placeholder-brand-inkmuted focus:outline-none focus:ring-2 focus:ring-brand-primary/40 focus:border-brand-primary/30 transition-all resize-none min-h-[46px] max-h-[120px] overflow-y-auto align-bottom"
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
                  className="bg-gradient-to-r from-brand-primary to-brand-accent hover:from-brand-accent hover:to-brand-gold text-white p-3.5 rounded-2xl transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.95] disabled:opacity-30 disabled:hover:translate-y-0 shadow-lg shadow-brand-primary/20 flex-shrink-0"
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
              <div className="w-20 h-20 rounded-2xl bg-brand-primary/[0.08] border border-brand-primary/20 flex items-center justify-center mx-auto mb-5">
                <MessageSquare size={32} className="text-brand-primary/60" />
              </div>
              <h3 className="text-brand-ink font-serif font-bold text-lg mb-2">Tu Inbox</h3>
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

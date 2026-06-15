import { useState } from 'react';
import { MessageSquare, Send, UserCheck, Bot, Search } from 'lucide-react';
import type { WhatsAppConversation } from '../types';
import { useWhatsAppInbox } from '../hooks/useWhatsAppInbox';

function formatTime(ts: string) {
  return new Date(ts).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
}

export default function WhatsAppInbox() {
  const {
    conversations,
    activeConvo,
    messages,
    draft,
    setDraft,
    selectConversation,
    send,
    toggleHandover,
  } = useWhatsAppInbox();
  const [search, setSearch] = useState('');

  const filtered = search
    ? conversations.filter((c: WhatsAppConversation) =>
        (c.contact_name || c.phone).toLowerCase().includes(search.toLowerCase())
      )
    : conversations;

  return (
    <div className="flex h-screen bg-[#0b0f1a]">
      {/* Conversation List */}
      <div className="w-80 border-r border-white/5 flex flex-col bg-[#111827]/50">
        <div className="p-4 border-b border-white/5">
          <h2 className="font-bold text-white text-lg mb-3 flex items-center gap-2">
            <MessageSquare size={18} className="text-indigo-400" />
            Inbox
          </h2>
          <div className="relative">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-600" />
            <input
              type="text"
              placeholder="Buscar conversación..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full bg-white/5 border border-white/10 text-white text-xs rounded-xl pl-9 pr-3 py-2.5 placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {filtered.map((c) => (
            <button
              key={c.id}
              onClick={() => selectConversation(c)}
              className={`w-full text-left p-4 border-b border-white/5 transition-all duration-200 ${
                activeConvo?.id === c.id
                  ? 'bg-indigo-500/10 border-l-2 border-l-indigo-500'
                  : 'hover:bg-white/5 border-l-2 border-l-transparent'
              }`}
            >
              <div className="flex items-start justify-between mb-1">
                <span className="font-medium text-white text-sm truncate">
                  {c.contact_name || c.phone}
                </span>
                <span className="text-[10px] text-slate-600 whitespace-nowrap ml-2">
                  {c.last_message_at ? formatTime(c.last_message_at) : ''}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <p className="text-xs text-slate-500 truncate pr-2">{c.last_message}</p>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  {c.unread_count > 0 && (
                    <span className="bg-emerald-500 text-white text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center">
                      {c.unread_count}
                    </span>
                  )}
                  {c.status === 'HANDOVER' && (
                    <span className="text-[9px] text-rose-400 font-bold uppercase tracking-wider">Humano</span>
                  )}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 flex flex-col">
        {activeConvo ? (
          <>
            {/* Chat Header */}
            <div className="px-6 py-4 border-b border-white/5 flex items-center justify-between bg-[#111827]/30">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center">
                  <span className="text-indigo-400 font-bold text-sm">
                    {(activeConvo.contact_name || activeConvo.phone).charAt(0).toUpperCase()}
                  </span>
                </div>
                <div>
                  <h3 className="font-semibold text-white text-sm">{activeConvo.contact_name || activeConvo.phone}</h3>
                  <p className="text-[11px] text-slate-500 font-mono">{activeConvo.phone}</p>
                </div>
              </div>
              <button
                onClick={toggleHandover}
                className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold border transition-all duration-200 ${
                  activeConvo.status === 'HANDOVER'
                    ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20 hover:bg-emerald-500/20'
                    : 'bg-rose-500/10 text-rose-400 border-rose-500/20 hover:bg-rose-500/20'
                }`}
              >
                {activeConvo.status === 'HANDOVER' ? <Bot size={14} /> : <UserCheck size={14} />}
                {activeConvo.status === 'HANDOVER' ? 'Devolver al Bot' : 'Tomar Conversación'}
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.direction === 'OUTBOUND' ? 'justify-end' : 'justify-start'}`}
                >
                  <div
                    className={`max-w-[70%] px-4 py-2.5 rounded-2xl text-sm ${
                      m.direction === 'OUTBOUND'
                        ? 'bg-indigo-600 text-white rounded-br-md'
                        : 'bg-white/10 text-slate-200 rounded-bl-md'
                    }`}
                  >
                    <p>{m.content}</p>
                    <p className={`text-[10px] mt-1 ${m.direction === 'OUTBOUND' ? 'text-indigo-200' : 'text-slate-500'}`}>
                      {formatTime(m.timestamp)}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            {/* Input */}
            <div className="px-6 py-4 border-t border-white/5 bg-[#111827]/30">
              <div className="flex gap-3">
                <input
                  className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && send()}
                  placeholder="Escribí un mensaje…"
                />
                <button
                  onClick={send}
                  disabled={!draft.trim()}
                  className="bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white px-5 py-3 rounded-xl transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-30 disabled:hover:translate-y-0 shadow-lg shadow-indigo-600/20"
                >
                  <Send size={18} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <MessageSquare size={48} className="text-slate-700 mx-auto mb-4" />
              <p className="text-slate-500 text-sm">Elegí una conversación para empezar</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

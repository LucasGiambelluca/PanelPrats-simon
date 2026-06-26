import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Brain, Send, Loader2, Sparkles, MessageSquareText, BookOpen, MapPin, FileText, Check, X, Trash2, Plus } from 'lucide-react';
import { agenteApi, type BrainState, type AgenteChange } from '../lib/api';

const AVATAR = '/agente/bot-avatar.png';
const REACTION_VIDEO = '/agente/bot-ok.mp4';
const prefersReducedMotion = () =>
  typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type Msg = { role: 'user' | 'assistant'; content: string };

// Descripción legible de un cambio propuesto (para la tarjeta de confirmación).
function describeChange(c: AgenteChange): string {
  switch (c.type) {
    case 'set_tono': return `Tono → "${c.texto}"`;
    case 'set_datos': return `Datos (${c.modo}): "${c.texto}"`;
    case 'set_procedimientos': return `Procedimientos (${c.modo}): "${c.texto}"`;
    case 'add_faq': return `Nueva FAQ: "${c.pregunta}" → "${c.respuesta}"`;
    case 'edit_faq': return `Editar FAQ "${c.pregunta}"${c.nueva_respuesta ? ` → "${c.nueva_respuesta}"` : ''}`;
    case 'remove_faq': return `Borrar FAQ "${c.pregunta}"`;
    case 'add_zona': return `Zona: ${c.localidad} → ${c.oficina}`;
    case 'remove_zona': return `Quitar zona "${c.localidad}"`;
  }
}

export default function Agente() {
  const [state, setState] = useState<BrainState | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [pending, setPending] = useState<AgenteChange[]>([]);
  const [busy, setBusy] = useState(false);
  // Reacción: el video del bot se reproduce SOLO cuando llega una orden nueva.
  const [reactionKey, setReactionKey] = useState(0);
  const [showReaction, setShowReaction] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // Borradores editables del cerebro (textareas).
  const [tonoDraft, setTonoDraft] = useState('');
  const [datosDraft, setDatosDraft] = useState('');
  const [procDraft, setProcDraft] = useState('');

  const loadState = () => agenteApi.state().then(setState).catch((e) => toast.error(e.message));
  useEffect(() => { loadState(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, pending, showReaction]);

  useEffect(() => {
    if (!state) return;
    setTonoDraft(state.tono ?? '');
    setDatosDraft(state.datos ?? '');
    setProcDraft(state.procedimientos ?? '');
  }, [state]);

  function reactToOrder() {
    if (prefersReducedMotion()) return;     // respeta reduced-motion
    setReactionKey((k) => k + 1);
    setShowReaction(true);                  // se oculta solo en onEnded del video
  }

  async function applyChange(change: AgenteChange, okMsg: string) {
    setBusy(true);
    try { await agenteApi.apply([change]); toast.success(okMsg); await loadState(); }
    catch (e: any) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next); setInput(''); setBusy(true); setPending([]);
    try {
      const r = await agenteApi.chat(next);
      setMessages([...next, { role: 'assistant', content: r.reply }]);
      setPending(r.pendingChanges);
      reactToOrder();                       // ▶ el bot reacciona a la orden recibida
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  async function apply() {
    if (!pending.length) return;
    setBusy(true);
    try {
      const r = await agenteApi.apply(pending);
      toast.success(`Aplicado a ${state?.lineas ?? 0} línea(s) — ${r.applied} cambio(s)`);
      setPending([]); await loadState();
    } catch (e: any) { toast.error(e.message); } finally { setBusy(false); }
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-5 p-5 h-full bg-brand-ivory/40">
      {/* ── CEREBRO ─────────────────────────────────────────────── */}
      <section className="flex flex-col min-h-0">
        <header className="flex items-center justify-between mb-4">
          <h1 className="flex items-center gap-2 text-xl font-bold text-brand-ink">
            <span className="grid place-items-center w-9 h-9 rounded-xl bg-brand-primary text-white"><Brain size={18} /></span>
            Cerebro del agente
          </h1>
          {state && (
            <span className="text-xs font-semibold text-brand-primary bg-brand-primary/10 px-2.5 py-1 rounded-full">
              {state.lineas} línea{state.lineas === 1 ? '' : 's'}
            </span>
          )}
        </header>

        <div className="flex-1 overflow-y-auto pr-1 space-y-4">
          {!state ? (
            <div className="grid place-items-center py-16 text-gray-400"><Loader2 className="animate-spin" /></div>
          ) : (
            <>
              <Card icon={<MessageSquareText size={16} />} title="Tono">
                <FieldEditor value={tonoDraft} onChange={setTonoDraft} rows={3} placeholder="Cálido, claro, breve. Tuteá, sin jerga…"
                  busy={busy} onSave={() => applyChange({ type: 'set_tono', texto: tonoDraft }, 'Tono actualizado')} />
              </Card>

              <Card icon={<FileText size={16} />} title="Datos del estudio">
                <FieldEditor value={datosDraft} onChange={setDatosDraft} rows={4} placeholder="Horarios, direcciones, precios, servicios…"
                  busy={busy} onSave={() => applyChange({ type: 'set_datos', texto: datosDraft, modo: 'reemplazar' }, 'Datos actualizados')} />
              </Card>

              <Card icon={<Sparkles size={16} />} title="Procedimientos">
                <FieldEditor value={procDraft} onChange={setProcDraft} rows={4} placeholder="Cómo proceder en cada caso (los “flujos” en lenguaje natural)…"
                  busy={busy} onSave={() => applyChange({ type: 'set_procedimientos', texto: procDraft, modo: 'reemplazar' }, 'Procedimientos actualizados')} />
              </Card>

              <Card icon={<BookOpen size={16} />} title={`FAQs (${state.faqs.length})`}>
                <div className="space-y-2.5">
                  {state.faqs.map((f) => <FaqRow key={f.id} faq={f} busy={busy} applyChange={applyChange} />)}
                  {state.faqs.length === 0 && <p className="text-sm text-gray-400 italic">Sin preguntas frecuentes todavía.</p>}
                </div>
                <AddFaqForm busy={busy} applyChange={applyChange} />
              </Card>

              <Card icon={<MapPin size={16} />} title={`Zonas (${state.zonas.length})`}>
                <ul className="space-y-1.5">
                  {state.zonas.map((z) => (
                    <li key={z.id} className="flex items-center justify-between gap-2 text-sm bg-gray-50 rounded-lg px-2.5 py-1.5">
                      <span className="text-brand-ink"><b className="capitalize">{z.alias}</b> <span className="text-gray-400">→</span> {z.oficina}</span>
                      <IconBtn label={`Borrar zona ${z.alias}`} danger busy={busy}
                        onClick={() => { if (window.confirm(`¿Borrar zona "${z.alias}"?`)) applyChange({ type: 'remove_zona', localidad: z.alias }, 'Zona borrada'); }}>
                        <Trash2 size={14} />
                      </IconBtn>
                    </li>
                  ))}
                  {state.zonas.length === 0 && <p className="text-sm text-gray-400 italic">Sin zonas cargadas.</p>}
                </ul>
                <AddZonaForm busy={busy} applyChange={applyChange} />
              </Card>
            </>
          )}
        </div>
      </section>

      {/* ── CHAT ────────────────────────────────────────────────── */}
      <section className="flex flex-col min-h-0 rounded-2xl bg-white shadow-sm ring-1 ring-black/5 overflow-hidden">
        {/* Header del chat con el avatar del bot */}
        <header className="flex items-center gap-3 px-4 py-3 bg-brand-primary text-white">
          <img src={AVATAR} alt="Agente" className="w-11 h-11 rounded-full object-cover ring-2 ring-brand-gold/80" />
          <div className="leading-tight">
            <p className="font-semibold">Agente</p>
            <p className="flex items-center gap-1.5 text-xs text-white/70">
              <span className="w-1.5 h-1.5 rounded-full bg-brand-gold inline-block" /> Configurá la atención conversando
            </p>
          </div>
        </header>

        {/* Mensajes */}
        <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3 bg-brand-ivory/30">
          {messages.length === 0 && !showReaction && (
            <div className="flex flex-col items-center text-center text-gray-500 mt-10">
              <img src={AVATAR} alt="" className="w-28 h-28 rounded-full object-cover ring-4 ring-white shadow-md" />
              <p className="mt-4 font-medium text-brand-ink">¿Qué mejoramos de la atención?</p>
              <p className="mt-1 text-sm max-w-xs">Ej: <span className="text-brand-secondary">“sé más cálido con los mayores”</span> o <span className="text-brand-secondary">“agregá que la consulta sale $29.000”</span>.</p>
            </div>
          )}

          {messages.map((m, i) => (
            m.role === 'assistant' ? (
              <div key={i} className="flex items-end gap-2">
                <img src={AVATAR} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
                <div className="max-w-[80%] px-3.5 py-2 rounded-2xl rounded-bl-sm bg-white ring-1 ring-black/5 text-sm text-brand-ink whitespace-pre-wrap">{m.content}</div>
              </div>
            ) : (
              <div key={i} className="flex justify-end">
                <div className="max-w-[80%] px-3.5 py-2 rounded-2xl rounded-br-sm bg-brand-secondary text-white text-sm whitespace-pre-wrap">{m.content}</div>
              </div>
            )
          ))}

          {busy && (
            <div className="flex items-end gap-2">
              <img src={AVATAR} alt="" className="w-8 h-8 rounded-full object-cover shrink-0" />
              <div className="px-4 py-3 rounded-2xl rounded-bl-sm bg-white ring-1 ring-black/5">
                <span className="flex gap-1">
                  <Dot /><Dot delay="150ms" /><Dot delay="300ms" />
                </span>
              </div>
            </div>
          )}

          {/* ▶ Reacción del bot: el video se reproduce SOLO al recibir una orden nueva */}
          {showReaction && (
            <div className="flex justify-center py-2">
              <video key={reactionKey} src={REACTION_VIDEO} autoPlay muted playsInline
                onEnded={() => setShowReaction(false)}
                className="w-44 h-44 object-contain drop-shadow" />
            </div>
          )}

          {/* Tarjeta de cambios propuestos */}
          {pending.length > 0 && (
            <div className="ml-10 rounded-xl ring-1 ring-brand-secondary/40 bg-white shadow-sm overflow-hidden">
              <div className="px-3.5 py-2 bg-brand-secondary/10 text-brand-ink text-sm font-semibold flex items-center gap-1.5">
                <Sparkles size={15} className="text-brand-secondary" /> Cambios propuestos
              </div>
              <ol className="px-4 py-2.5 text-sm text-brand-ink space-y-1.5 list-decimal list-inside">
                {pending.map((c, i) => <li key={i}>{describeChange(c)}</li>)}
              </ol>
              <div className="flex gap-2 px-3.5 pb-3.5">
                <button onClick={apply} disabled={busy}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-secondary text-white text-sm font-medium hover:brightness-95 disabled:opacity-50 transition">
                  <Check size={15} /> Aplicar a {state?.lineas ?? 0} línea{state?.lineas === 1 ? '' : 's'}
                </button>
                <button onClick={() => setPending([])} disabled={busy}
                  className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg border border-gray-200 text-gray-600 text-sm hover:bg-gray-50 disabled:opacity-50 transition">
                  <X size={15} /> Descartar
                </button>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>

        {/* Input */}
        <div className="flex items-center gap-2 p-3 border-t border-gray-100 bg-white">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Escribí una orden para el agente…" disabled={busy}
            className="flex-1 px-4 py-2.5 rounded-full bg-gray-100 text-sm text-brand-ink placeholder:text-gray-400 outline-none focus:ring-2 focus:ring-brand-secondary/50 disabled:opacity-60" />
          <button onClick={send} disabled={busy || !input.trim()} aria-label="Enviar orden"
            className="grid place-items-center w-11 h-11 rounded-full bg-brand-secondary text-white hover:brightness-95 disabled:opacity-40 transition shrink-0">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </section>
    </div>
  );
}

/* ── Sub-componentes ─────────────────────────────────────────── */

function Card({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl bg-white ring-1 ring-black/5 shadow-sm p-4">
      <h2 className="flex items-center gap-1.5 text-sm font-bold text-brand-secondary mb-2.5">{icon}{title}</h2>
      <div className="text-sm text-brand-ink">{children}</div>
    </div>
  );
}

function Dot({ delay = '0ms' }: { delay?: string }) {
  return <span className="w-1.5 h-1.5 rounded-full bg-brand-secondary/60 animate-bounce" style={{ animationDelay: delay }} />;
}

const textareaCls = 'w-full px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm text-brand-ink resize-y outline-none focus:ring-2 focus:ring-brand-secondary/40 focus:bg-white transition';
const inputCls = 'w-full px-3 py-2 rounded-xl bg-gray-50 border border-gray-200 text-sm outline-none focus:ring-2 focus:ring-brand-secondary/40 focus:bg-white transition';
const saveBtnCls = 'px-3.5 py-1.5 rounded-lg bg-brand-secondary text-white text-sm font-medium hover:brightness-95 disabled:opacity-50 transition';

function FieldEditor({ value, onChange, rows, placeholder, busy, onSave }:
  { value: string; onChange: (v: string) => void; rows: number; placeholder: string; busy: boolean; onSave: () => void }) {
  return (
    <>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={rows} placeholder={placeholder} className={textareaCls} />
      <div className="flex justify-end mt-2">
        <button onClick={onSave} disabled={busy} className={saveBtnCls}>Guardar</button>
      </div>
    </>
  );
}

function IconBtn({ children, label, onClick, busy, danger }:
  { children: React.ReactNode; label: string; onClick: () => void; busy: boolean; danger?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} aria-label={label}
      className={`grid place-items-center w-7 h-7 rounded-lg transition disabled:opacity-40 ${danger ? 'text-red-500 hover:bg-red-50' : 'text-brand-secondary hover:bg-brand-secondary/10'}`}>
      {children}
    </button>
  );
}

type ApplyFn = (change: AgenteChange, okMsg: string) => Promise<void>;

function FaqRow({ faq, busy, applyChange }: { faq: BrainState['faqs'][number]; busy: boolean; applyChange: ApplyFn }) {
  const [resp, setResp] = useState(faq.respuesta);
  useEffect(() => { setResp(faq.respuesta); }, [faq.respuesta]);
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-2.5">
      <p className="font-semibold text-brand-ink mb-1.5">{faq.pregunta}</p>
      <textarea value={resp} onChange={(e) => setResp(e.target.value)} rows={2} className={textareaCls} />
      <div className="flex justify-end gap-2 mt-1.5">
        <button onClick={() => applyChange({ type: 'edit_faq', pregunta: faq.pregunta, nueva_respuesta: resp }, 'FAQ actualizada')}
          disabled={busy} className="px-2.5 py-1 rounded-lg bg-brand-secondary text-white text-xs font-medium hover:brightness-95 disabled:opacity-50 transition">Guardar</button>
        <button onClick={() => { if (window.confirm(`¿Borrar FAQ "${faq.pregunta}"?`)) applyChange({ type: 'remove_faq', pregunta: faq.pregunta }, 'FAQ borrada'); }}
          disabled={busy} className="px-2.5 py-1 rounded-lg border border-gray-200 text-red-500 text-xs hover:bg-red-50 disabled:opacity-50 transition">Borrar</button>
      </div>
    </div>
  );
}

function AddFaqForm({ busy, applyChange }: { busy: boolean; applyChange: ApplyFn }) {
  const [pregunta, setPregunta] = useState('');
  const [respuesta, setRespuesta] = useState('');
  async function add() {
    if (!pregunta.trim() || !respuesta.trim()) return;
    await applyChange({ type: 'add_faq', pregunta: pregunta.trim(), respuesta: respuesta.trim() }, 'FAQ agregada');
    setPregunta(''); setRespuesta('');
  }
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 space-y-2">
      <input value={pregunta} onChange={(e) => setPregunta(e.target.value)} placeholder="Pregunta" className={inputCls} />
      <input value={respuesta} onChange={(e) => setRespuesta(e.target.value)} placeholder="Respuesta" className={inputCls} />
      <div className="flex justify-end">
        <button onClick={add} disabled={busy} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-brand-primary text-white text-sm font-medium hover:brightness-125 disabled:opacity-50 transition">
          <Plus size={15} /> Agregar FAQ
        </button>
      </div>
    </div>
  );
}

function AddZonaForm({ busy, applyChange }: { busy: boolean; applyChange: ApplyFn }) {
  const [localidad, setLocalidad] = useState('');
  const [oficina, setOficina] = useState<'CABA' | 'Quilmes' | 'Haedo'>('CABA');
  async function add() {
    if (!localidad.trim()) return;
    await applyChange({ type: 'add_zona', localidad: localidad.trim(), oficina }, 'Zona agregada');
    setLocalidad('');
  }
  return (
    <div className="mt-3 pt-3 border-t border-gray-100 flex gap-2">
      <input value={localidad} onChange={(e) => setLocalidad(e.target.value)} placeholder="Localidad" className={`${inputCls} flex-1`} />
      <select value={oficina} onChange={(e) => setOficina(e.target.value as any)} className={inputCls.replace('w-full', '')}>
        <option value="CABA">CABA</option>
        <option value="Quilmes">Quilmes</option>
        <option value="Haedo">Haedo</option>
      </select>
      <button onClick={add} disabled={busy} className="flex items-center gap-1.5 px-3.5 py-2 rounded-lg bg-brand-primary text-white text-sm font-medium hover:brightness-125 disabled:opacity-50 transition shrink-0">
        <Plus size={15} /> Agregar
      </button>
    </div>
  );
}

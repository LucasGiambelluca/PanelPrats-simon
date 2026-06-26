import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Brain, Send, Loader2 } from 'lucide-react';
import { agenteApi, type BrainState, type AgenteChange } from '../lib/api';

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
  const endRef = useRef<HTMLDivElement>(null);

  const loadState = () => agenteApi.state().then(setState).catch((e) => toast.error(e.message));
  useEffect(() => { loadState(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, pending]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next = [...messages, { role: 'user' as const, content: text }];
    setMessages(next); setInput(''); setBusy(true); setPending([]);
    try {
      const r = await agenteApi.chat(next);
      setMessages([...next, { role: 'assistant', content: r.reply }]);
      setPending(r.pendingChanges);
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
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4 h-full">
      {/* Cerebro */}
      <section className="space-y-3 overflow-y-auto">
        <h1 className="flex items-center gap-2 text-lg font-semibold text-brand-ink"><Brain size={20} /> Cerebro del agente</h1>
        {!state ? <Loader2 className="animate-spin" /> : (
          <>
            <Card title="Tono">{state.tono || <em className="text-gray-400">(vacío)</em>}</Card>
            <Card title="Datos del estudio">{state.datos || <em className="text-gray-400">(vacío)</em>}</Card>
            <Card title="Procedimientos">{state.procedimientos || <em className="text-gray-400">(vacío)</em>}</Card>
            <Card title={`FAQs (${state.faqs.length})`}>
              <ul className="list-disc pl-4 space-y-1">{state.faqs.map((f) => <li key={f.id}><b>{f.pregunta}</b> → {f.respuesta}</li>)}</ul>
            </Card>
            <Card title={`Zonas (${state.zonas.length})`}>
              <ul className="list-disc pl-4 space-y-1">{state.zonas.map((z) => <li key={z.id}>{z.alias} → {z.oficina}</li>)}</ul>
            </Card>
          </>
        )}
      </section>

      {/* Chat */}
      <section className="flex flex-col border border-gray-200 rounded-xl bg-white min-h-[400px]">
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center text-center text-gray-500 mt-8">
              <img src="/agente/bot-avatar.png" alt="Agente" className="w-20 h-20 rounded-full object-cover mb-2" />
              <video src="/agente/bot-ok.mp4" autoPlay loop muted playsInline className="w-32 h-32 object-contain" />
              <p className="mt-2">Decime qué mejorar de la atención y lo preparo. 👋</p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
              <span className={`inline-block px-3 py-2 rounded-2xl text-sm ${m.role === 'user' ? 'bg-brand-secondary text-white' : 'bg-gray-100 text-brand-ink'}`}>{m.content}</span>
            </div>
          ))}
          {pending.length > 0 && (
            <div className="border border-brand-secondary/40 rounded-lg p-3 bg-brand-ivory">
              <p className="font-semibold text-sm mb-2">Cambios propuestos:</p>
              <ol className="list-decimal pl-5 text-sm space-y-1">{pending.map((c, i) => <li key={i}>{describeChange(c)}</li>)}</ol>
              <div className="flex gap-2 mt-3">
                <button onClick={apply} disabled={busy} className="px-3 py-1.5 rounded-lg bg-brand-secondary text-white text-sm disabled:opacity-50">Aplicar a las {state?.lineas ?? 0} líneas</button>
                <button onClick={() => setPending([])} disabled={busy} className="px-3 py-1.5 rounded-lg border text-sm">Descartar</button>
              </div>
            </div>
          )}
          <div ref={endRef} />
        </div>
        <div className="flex gap-2 p-3 border-t">
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && send()}
            placeholder="Ej: sé más cálido con los mayores" className="flex-1 px-3 py-2 rounded-lg border text-sm" disabled={busy} />
          <button onClick={send} disabled={busy} className="px-3 py-2 rounded-lg bg-brand-secondary text-white disabled:opacity-50">
            {busy ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </section>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-gray-200 rounded-xl bg-white p-3">
      <h2 className="text-sm font-semibold text-brand-secondary mb-1">{title}</h2>
      <div className="text-sm text-brand-ink whitespace-pre-wrap">{children}</div>
    </div>
  );
}

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

  // Borradores editables del cerebro (textareas).
  const [tonoDraft, setTonoDraft] = useState('');
  const [datosDraft, setDatosDraft] = useState('');
  const [procDraft, setProcDraft] = useState('');

  const loadState = () => agenteApi.state().then(setState).catch((e) => toast.error(e.message));
  useEffect(() => { loadState(); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, pending]);

  // Sembrar los borradores cuando llega/cambia el estado.
  useEffect(() => {
    if (!state) return;
    setTonoDraft(state.tono ?? '');
    setDatosDraft(state.datos ?? '');
    setProcDraft(state.procedimientos ?? '');
  }, [state]);

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
            <Card title="Tono">
              <textarea value={tonoDraft} onChange={(e) => setTonoDraft(e.target.value)} rows={3}
                className="w-full px-2 py-1.5 rounded-lg border text-sm resize-y" placeholder="Cálido, claro, breve…" />
              <div className="flex justify-end mt-2">
                <button onClick={() => applyChange({ type: 'set_tono', texto: tonoDraft }, 'Tono actualizado')} disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-brand-secondary text-white text-sm disabled:opacity-50">Guardar</button>
              </div>
            </Card>

            <Card title="Datos del estudio">
              <textarea value={datosDraft} onChange={(e) => setDatosDraft(e.target.value)} rows={4}
                className="w-full px-2 py-1.5 rounded-lg border text-sm resize-y" placeholder="Horarios, dirección, teléfonos…" />
              <div className="flex justify-end mt-2">
                <button onClick={() => applyChange({ type: 'set_datos', texto: datosDraft, modo: 'reemplazar' }, 'Datos actualizados')} disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-brand-secondary text-white text-sm disabled:opacity-50">Guardar</button>
              </div>
            </Card>

            <Card title="Procedimientos">
              <textarea value={procDraft} onChange={(e) => setProcDraft(e.target.value)} rows={4}
                className="w-full px-2 py-1.5 rounded-lg border text-sm resize-y" placeholder="Cómo se atiende cada caso…" />
              <div className="flex justify-end mt-2">
                <button onClick={() => applyChange({ type: 'set_procedimientos', texto: procDraft, modo: 'reemplazar' }, 'Procedimientos actualizados')} disabled={busy}
                  className="px-3 py-1.5 rounded-lg bg-brand-secondary text-white text-sm disabled:opacity-50">Guardar</button>
              </div>
            </Card>

            <Card title={`FAQs (${state.faqs.length})`}>
              <div className="space-y-3">
                {state.faqs.map((f) => <FaqRow key={f.id} faq={f} busy={busy} applyChange={applyChange} />)}
                {state.faqs.length === 0 && <em className="text-gray-400">(sin FAQs)</em>}
              </div>
              <AddFaqForm busy={busy} applyChange={applyChange} />
            </Card>

            <Card title={`Zonas (${state.zonas.length})`}>
              <ul className="space-y-1">
                {state.zonas.map((z) => (
                  <li key={z.id} className="flex items-center justify-between gap-2">
                    <span>{z.alias} → {z.oficina}</span>
                    <button onClick={() => { if (window.confirm(`¿Borrar zona "${z.alias}"?`)) applyChange({ type: 'remove_zona', localidad: z.alias }, 'Zona borrada'); }}
                      disabled={busy} className="px-2 py-0.5 rounded border text-xs text-red-600 disabled:opacity-50">Borrar</button>
                  </li>
                ))}
                {state.zonas.length === 0 && <em className="text-gray-400">(sin zonas)</em>}
              </ul>
              <AddZonaForm busy={busy} applyChange={applyChange} />
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

type ApplyFn = (change: AgenteChange, okMsg: string) => Promise<void>;

function FaqRow({ faq, busy, applyChange }: { faq: BrainState['faqs'][number]; busy: boolean; applyChange: ApplyFn }) {
  const [resp, setResp] = useState(faq.respuesta);
  useEffect(() => { setResp(faq.respuesta); }, [faq.respuesta]);
  return (
    <div className="border border-gray-100 rounded-lg p-2">
      <p className="font-semibold mb-1">{faq.pregunta}</p>
      <textarea value={resp} onChange={(e) => setResp(e.target.value)} rows={2}
        className="w-full px-2 py-1.5 rounded-lg border text-sm resize-y" />
      <div className="flex justify-end gap-2 mt-1">
        <button onClick={() => applyChange({ type: 'edit_faq', pregunta: faq.pregunta, nueva_respuesta: resp }, 'FAQ actualizada')}
          disabled={busy} className="px-2 py-0.5 rounded bg-brand-secondary text-white text-xs disabled:opacity-50">Guardar</button>
        <button onClick={() => { if (window.confirm(`¿Borrar FAQ "${faq.pregunta}"?`)) applyChange({ type: 'remove_faq', pregunta: faq.pregunta }, 'FAQ borrada'); }}
          disabled={busy} className="px-2 py-0.5 rounded border text-xs text-red-600 disabled:opacity-50">Borrar</button>
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
    <div className="mt-3 pt-3 border-t space-y-2">
      <input value={pregunta} onChange={(e) => setPregunta(e.target.value)} placeholder="Pregunta"
        className="w-full px-2 py-1.5 rounded-lg border text-sm" />
      <input value={respuesta} onChange={(e) => setRespuesta(e.target.value)} placeholder="Respuesta"
        className="w-full px-2 py-1.5 rounded-lg border text-sm" />
      <div className="flex justify-end">
        <button onClick={add} disabled={busy} className="px-3 py-1.5 rounded-lg bg-brand-secondary text-white text-sm disabled:opacity-50">Agregar FAQ</button>
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
    <div className="mt-3 pt-3 border-t flex gap-2">
      <input value={localidad} onChange={(e) => setLocalidad(e.target.value)} placeholder="Localidad"
        className="flex-1 px-2 py-1.5 rounded-lg border text-sm" />
      <select value={oficina} onChange={(e) => setOficina(e.target.value as any)} className="px-2 py-1.5 rounded-lg border text-sm">
        <option value="CABA">CABA</option>
        <option value="Quilmes">Quilmes</option>
        <option value="Haedo">Haedo</option>
      </select>
      <button onClick={add} disabled={busy} className="px-3 py-1.5 rounded-lg bg-brand-secondary text-white text-sm disabled:opacity-50">Agregar</button>
    </div>
  );
}

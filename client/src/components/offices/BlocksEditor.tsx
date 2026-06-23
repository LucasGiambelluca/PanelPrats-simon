import { useEffect, useState, useCallback } from 'react';
import type { Office, OfficeProfessional, ProfessionalBlock } from '../../types';
import { professionalsApi } from '../../lib/api';
import { toast } from 'sonner';
import { Loader2, Plus, X, Trash2 } from 'lucide-react';

// datetime-local (YYYY-MM-DDTHH:MM) -> ISO con offset del navegador.
function toISO(local: string): string { return new Date(local).toISOString(); }
function fmt(iso: string): string { return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }); }

export default function BlocksEditor({ office, prof, onClose }: { office: Office; prof: OfficeProfessional; onClose: () => void }) {
  const [blocks, setBlocks] = useState<ProfessionalBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [motivo, setMotivo] = useState('');
  const [soloEsta, setSoloEsta] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setBlocks(await professionalsApi.getBlocks(prof.profile_id)); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [prof.profile_id]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!start || !end) { toast.error('Completá inicio y fin'); return; }
    if (toISO(end) <= toISO(start)) { toast.error('El fin debe ser posterior al inicio'); return; }
    setSaving(true);
    try {
      await professionalsApi.addBlock(prof.profile_id, {
        office_id: soloEsta ? office.id : null,
        start_time: toISO(start), end_time: toISO(end), motivo: motivo.trim() || null,
      });
      toast.success('Bloqueo agregado'); setStart(''); setEnd(''); setMotivo(''); load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (b: ProfessionalBlock) => {
    try { await professionalsApi.removeBlock(prof.profile_id, b.id); toast.success('Bloqueo borrado'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-brand-surface rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-serif font-bold text-brand-ink">Bloqueos de {prof.name}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-brand-inkmuted hover:text-brand-ink"><X size={18} /></button>
        </div>

        <div className="border border-brand-hairline rounded-xl p-3 mb-4 space-y-2">
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-brand-inkmuted">Desde<input type="datetime-local" className="mt-1 w-full bg-white border border-brand-hairline rounded-lg px-2 py-1.5 text-sm" value={start} onChange={e => setStart(e.target.value)} /></label>
            <label className="flex-1 text-xs text-brand-inkmuted">Hasta<input type="datetime-local" className="mt-1 w-full bg-white border border-brand-hairline rounded-lg px-2 py-1.5 text-sm" value={end} onChange={e => setEnd(e.target.value)} /></label>
          </div>
          <input className="w-full bg-white border border-brand-hairline rounded-lg px-3 py-2 text-sm" placeholder="Motivo (opcional)" value={motivo} onChange={e => setMotivo(e.target.value)} />
          <label className="flex items-center gap-2 text-xs text-brand-inkmuted">
            <input type="checkbox" checked={soloEsta} onChange={e => setSoloEsta(e.target.checked)} />
            Solo en {office.nombre} (destildá para todas las oficinas)
          </label>
          <button onClick={add} disabled={saving} className="flex items-center gap-1.5 bg-brand-primary text-white px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Agregar bloqueo
          </button>
        </div>

        {loading ? (
          <div className="py-6 flex justify-center"><Loader2 size={20} className="animate-spin text-brand-primary" /></div>
        ) : blocks.length === 0 ? (
          <p className="text-sm text-brand-inkmuted">Sin bloqueos.</p>
        ) : (
          <div className="space-y-2">
            {blocks.map(b => (
              <div key={b.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-brand-hairline">
                <div>
                  <div className="text-sm text-brand-ink">{fmt(b.start_time)} → {fmt(b.end_time)}</div>
                  <div className="text-xs text-brand-inkmuted">{b.motivo || 'Sin motivo'}{b.office_id ? '' : ' · todas las oficinas'}</div>
                </div>
                <button onClick={() => remove(b)} aria-label="Borrar" className="p-2 text-brand-inkmuted hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

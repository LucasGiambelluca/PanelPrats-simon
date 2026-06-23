import { useEffect, useState, useCallback } from 'react';
import { useAccounts } from '../context/AccountContext';
import { officesApi } from '../lib/api';
import type { Office } from '../types';
import { toast } from 'sonner';
import { Building2, Plus, Loader2, Pencil, Trash2 } from 'lucide-react';
import OfficeDetail from '../components/offices/OfficeDetail';

const emptyForm = {
  nombre: '', modalidad: 'presencial' as 'presencial' | 'video', direccion: '', video_link: '',
  hora_inicio: '09:00', hora_fin: '18:00', slot_min: 60, capacidad: 1, buffer_min: 0,
  dias: [1, 2, 3, 4, 5] as number[], activa: true, orden: 0,
};

export default function Offices() {
  const { activeAccountId } = useAccounts();
  const [list, setList] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Office | null>(null);

  const load = useCallback(async () => {
    if (!activeAccountId) { setList([]); setLoading(false); return; }
    setLoading(true);
    try { setList(await officesApi.list(activeAccountId)); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [activeAccountId]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (o: Office) => {
    setEditingId(o.id);
    setForm({
      nombre: o.nombre, modalidad: o.modalidad, direccion: o.direccion ?? '', video_link: o.video_link ?? '',
      hora_inicio: o.hora_inicio, hora_fin: o.hora_fin, slot_min: o.slot_min, capacidad: o.capacidad,
      buffer_min: o.buffer_min, dias: o.dias, activa: o.activa, orden: o.orden,
    });
  };

  const reset = () => { setEditingId(null); setForm(emptyForm); };

  const save = async () => {
    if (!activeAccountId) { toast.error('Elegí una cuenta'); return; }
    if (!form.nombre.trim()) { toast.error('Falta el nombre'); return; }
    if (form.modalidad === 'presencial' && !form.direccion.trim()) { toast.error('Una oficina presencial necesita dirección'); return; }
    if (form.hora_fin <= form.hora_inicio) { toast.error('hora_fin debe ser posterior a hora_inicio'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        direccion: form.direccion.trim() || null,
        video_link: form.video_link.trim() || null,
      };
      if (editingId) await officesApi.update(editingId, payload as any);
      else await officesApi.create({ account_id: activeAccountId, ...payload } as any);
      toast.success(editingId ? 'Oficina actualizada' : 'Oficina creada');
      reset(); load();
    } catch (e: any) { toast.error('Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const remove = async (o: Office) => {
    if (!confirm(`¿Borrar la oficina "${o.nombre}"? Se quitan sus profesionales y horarios.`)) return;
    try { await officesApi.remove(o.id); toast.success('Oficina borrada'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="min-h-screen bg-brand-ivory p-6 lg:p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8 border-b border-brand-hairline pb-6">
          <div className="w-11 h-11 rounded-xl bg-brand-primary/[0.07] text-brand-primary flex items-center justify-center">
            <Building2 size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-brand-ink font-serif">Oficinas</h1>
            <p className="text-sm text-brand-inkmuted">Cargá oficinas, asigná profesionales y configurá sus agendas</p>
          </div>
        </div>

        {!activeAccountId ? (
          <p className="text-sm text-brand-inkmuted">Elegí una cuenta activa en el menú lateral.</p>
        ) : (
          <>
            <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-6 mb-8 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gold" />
              <h2 className="text-brand-ink font-serif font-bold text-lg mb-4">{editingId ? 'Editar oficina' : 'Nueva oficina'}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input aria-label="Nombre" className="bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm" placeholder="Nombre (ej. CABA)" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
                <select aria-label="Modalidad" className="bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm" value={form.modalidad} onChange={e => setForm({ ...form, modalidad: e.target.value as any })}>
                  <option value="presencial">Presencial</option>
                  <option value="video">Video</option>
                </select>
                <input aria-label="Dirección" className="bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm" placeholder="Dirección (presencial)" value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} />
                <input aria-label="Link de video" className="bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm" placeholder="Link de video (opcional)" value={form.video_link} onChange={e => setForm({ ...form, video_link: e.target.value })} />
                <div className="flex gap-2">
                  <input aria-label="Hora inicio" type="time" className="bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm flex-1" value={form.hora_inicio} onChange={e => setForm({ ...form, hora_inicio: e.target.value })} />
                  <input aria-label="Hora fin" type="time" className="bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm flex-1" value={form.hora_fin} onChange={e => setForm({ ...form, hora_fin: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <input aria-label="Duración del turno (min)" type="number" min={1} className="bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm flex-1" placeholder="Slot min" value={form.slot_min} onChange={e => setForm({ ...form, slot_min: Number(e.target.value) })} />
                  <input aria-label="Capacidad" type="number" min={1} className="bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm flex-1" placeholder="Capacidad" value={form.capacidad} onChange={e => setForm({ ...form, capacidad: Number(e.target.value) })} />
                  <input aria-label="Buffer (min)" type="number" min={0} className="bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm flex-1" placeholder="Buffer min" value={form.buffer_min} onChange={e => setForm({ ...form, buffer_min: Number(e.target.value) })} />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button onClick={save} disabled={saving} className="flex items-center gap-2 bg-brand-primary text-white px-6 py-3 rounded-xl font-bold text-sm disabled:opacity-40">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {editingId ? 'Guardar' : 'Crear'}
                </button>
                {editingId && <button onClick={reset} className="text-sm text-brand-inkmuted px-4 py-3">Cancelar</button>}
              </div>
            </div>

            <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card overflow-hidden">
              {loading ? (
                <div className="p-10 flex justify-center"><Loader2 size={24} className="animate-spin text-brand-primary" /></div>
              ) : list.length === 0 ? (
                <p className="p-10 text-center text-brand-inkmuted text-sm">Sin oficinas todavía.</p>
              ) : list.map(o => (
                <div key={o.id} className="flex items-center justify-between px-5 py-4 border-b border-brand-hairline last:border-0">
                  <button className="text-left" onClick={() => setSelected(o)}>
                    <div className="text-brand-ink text-sm font-semibold">{o.nombre} <span className="text-brand-inkmuted font-normal">· {o.modalidad}</span></div>
                    <div className="text-brand-inkmuted text-xs">{o.direccion || (o.modalidad === 'video' ? 'Videollamada' : '—')}</div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelected(o)} className="text-xs px-3 py-2 rounded-xl border border-brand-hairline text-brand-primary font-semibold">Profesionales</button>
                    <button onClick={() => startEdit(o)} aria-label="Editar" className="p-2 rounded-xl border border-brand-hairline text-brand-inkmuted hover:text-brand-ink"><Pencil size={14} /></button>
                    <button onClick={() => remove(o)} aria-label="Borrar" className="p-2 rounded-xl border border-brand-hairline text-brand-inkmuted hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {selected && <OfficeDetail office={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}

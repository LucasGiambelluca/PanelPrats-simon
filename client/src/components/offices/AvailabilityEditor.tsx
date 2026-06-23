import { useEffect, useState, useCallback } from 'react';
import type { Office, OfficeProfessional, AvailabilityWindow } from '../../types';
import { professionalsApi } from '../../lib/api';
import { toast } from 'sonner';
import { Loader2, Plus, X } from 'lucide-react';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']; // index = dia 0-6

export default function AvailabilityEditor({ office, prof, onClose }: { office: Office; prof: OfficeProfessional; onClose: () => void }) {
  const [ventanas, setVentanas] = useState<AvailabilityWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setVentanas(await professionalsApi.getAvailability(prof.profile_id, office.id)); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [prof.profile_id, office.id]);

  useEffect(() => { load(); }, [load]);

  const addWindow = (dia: number) =>
    setVentanas(v => [...v, { dia, hora_inicio: office.hora_inicio, hora_fin: office.hora_fin }]);

  const updateWindow = (idx: number, patch: Partial<AvailabilityWindow>) =>
    setVentanas(v => v.map((w, i) => i === idx ? { ...w, ...patch } : w));

  const removeWindow = (idx: number) =>
    setVentanas(v => v.filter((_, i) => i !== idx));

  const save = async () => {
    for (const w of ventanas) {
      if (w.hora_fin <= w.hora_inicio) { toast.error('Cada ventana: hora fin posterior a inicio'); return; }
    }
    setSaving(true);
    try {
      await professionalsApi.setAvailability(prof.profile_id, office.id, ventanas);
      toast.success('Horario guardado'); onClose();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-brand-surface rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-serif font-bold text-brand-ink">Horario de {prof.name}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-brand-inkmuted hover:text-brand-ink"><X size={18} /></button>
        </div>
        <p className="text-xs text-brand-inkmuted mb-4">En {office.nombre}. Varias ventanas por día (ej. mañana y tarde).</p>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-brand-primary" /></div>
        ) : (
          <div className="space-y-4">
            {DIAS.map((label, dia) => {
              const wins = ventanas.map((w, i) => ({ w, i })).filter(({ w }) => w.dia === dia);
              return (
                <div key={dia} className="border border-brand-hairline rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-brand-ink">{label}</span>
                    <button onClick={() => addWindow(dia)} className="flex items-center gap-1 text-xs text-brand-primary font-semibold"><Plus size={13} /> Ventana</button>
                  </div>
                  {wins.length === 0 ? (
                    <p className="text-xs text-brand-inkmuted">No atiende</p>
                  ) : wins.map(({ w, i }) => (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <input type="time" className="bg-white border border-brand-hairline rounded-lg px-2 py-1.5 text-sm" value={w.hora_inicio} onChange={e => updateWindow(i, { hora_inicio: e.target.value })} />
                      <span className="text-brand-inkmuted text-xs">a</span>
                      <input type="time" className="bg-white border border-brand-hairline rounded-lg px-2 py-1.5 text-sm" value={w.hora_fin} onChange={e => updateWindow(i, { hora_fin: e.target.value })} />
                      <button onClick={() => removeWindow(i)} aria-label="Quitar ventana" className="text-brand-inkmuted hover:text-red-600 ml-1"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3 mt-6">
          <button onClick={save} disabled={saving || loading} className="flex items-center gap-2 bg-brand-primary text-white px-6 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} Guardar
          </button>
          <button onClick={onClose} className="text-sm text-brand-inkmuted">Cancelar</button>
        </div>
      </div>
    </div>
  );
}

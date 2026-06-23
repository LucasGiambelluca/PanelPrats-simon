import { useEffect, useState, useCallback } from 'react';
import type { Office, OfficeProfessional, ProfessionalLite } from '../../types';
import { officesApi, professionalsApi } from '../../lib/api';
import { toast } from 'sonner';
import { Loader2, UserPlus, X, Clock, CalendarX } from 'lucide-react';
import AvailabilityEditor from './AvailabilityEditor';
import BlocksEditor from './BlocksEditor';

export default function OfficeDetail({ office, onClose }: { office: Office; onClose: () => void }) {
  const [profs, setProfs] = useState<OfficeProfessional[]>([]);
  const [all, setAll] = useState<ProfessionalLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const [editAvailFor, setEditAvailFor] = useState<OfficeProfessional | null>(null);
  const [editBlocksFor, setEditBlocksFor] = useState<OfficeProfessional | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([officesApi.professionals(office.id), professionalsApi.list()]);
      setProfs(p); setAll(a);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [office.id]);

  useEffect(() => { load(); }, [load]);

  const assign = async () => {
    if (!adding) return;
    try { await officesApi.assign(office.id, adding); setAdding(''); toast.success('Profesional asignado'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const unassign = async (p: OfficeProfessional) => {
    try { await officesApi.unassign(office.id, p.profile_id); toast.success('Profesional quitado'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const assignable = all.filter(a => !profs.some(p => p.profile_id === a.id));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-brand-surface h-full p-6 overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-serif font-bold text-brand-ink">{office.nombre}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-brand-inkmuted hover:text-brand-ink"><X size={18} /></button>
        </div>
        <p className="text-xs text-brand-inkmuted mb-6">{office.direccion || (office.modalidad === 'video' ? 'Videollamada' : '—')}</p>

        <h3 className="text-sm font-bold text-brand-ink mb-3">Profesionales</h3>

        <div className="flex gap-2 mb-4">
          <select className="flex-1 bg-white border border-brand-hairline rounded-xl px-3 py-2.5 text-sm text-brand-ink" value={adding} onChange={e => setAdding(e.target.value)}>
            <option value="">Elegir profesional…</option>
            {assignable.map(a => <option key={a.id} value={a.id}>{a.name || '(sin nombre)'}</option>)}
          </select>
          <button onClick={assign} disabled={!adding} className="flex items-center gap-1.5 bg-brand-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40">
            <UserPlus size={15} /> Asignar
          </button>
        </div>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-brand-primary" /></div>
        ) : profs.length === 0 ? (
          <p className="text-sm text-brand-inkmuted py-4">Sin profesionales asignados.</p>
        ) : (
          <div className="space-y-2">
            {profs.map(p => (
              <div key={p.profile_id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-brand-hairline">
                <span className="text-sm text-brand-ink font-medium">{p.name || '(sin nombre)'}</span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setEditAvailFor(p)} title="Horario" className="p-2 rounded-lg border border-brand-hairline text-brand-inkmuted hover:text-brand-primary"><Clock size={14} /></button>
                  <button onClick={() => setEditBlocksFor(p)} title="Bloqueos" className="p-2 rounded-lg border border-brand-hairline text-brand-inkmuted hover:text-brand-primary"><CalendarX size={14} /></button>
                  <button onClick={() => unassign(p)} title="Quitar" className="p-2 rounded-lg border border-brand-hairline text-brand-inkmuted hover:text-red-600"><X size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editAvailFor && <AvailabilityEditor office={office} prof={editAvailFor} onClose={() => setEditAvailFor(null)} />}
        {editBlocksFor && <BlocksEditor office={office} prof={editBlocksFor} onClose={() => setEditBlocksFor(null)} />}
      </div>
    </div>
  );
}

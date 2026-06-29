import { useEffect, useState, useCallback } from 'react';
import { X, Calendar, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import {
  availabilityApi, appointmentsApi, MOTIVO_LABELS,
  type AvailabilityOffice, type FreeSlot, type AppointmentMotivo,
} from '../lib/api';

interface Props {
  open: boolean;
  onClose: () => void;
  accountId: string;
  phone: string;
  contactName: string;
  onBooked?: () => void;
}

function slotLabel(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', {
    weekday: 'short', day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });
}

export default function BookFromChatModal({ open, onClose, accountId, phone, contactName, onBooked }: Props) {
  const [offices, setOffices] = useState<AvailabilityOffice[]>([]);
  const [officeId, setOfficeId] = useState('');
  const [profesionalId, setProfesionalId] = useState('');
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [slotIdx, setSlotIdx] = useState<number | null>(null);
  const [nombre, setNombre] = useState(contactName || '');
  const [motivo, setMotivo] = useState<AppointmentMotivo | ''>('');
  const [nota, setNota] = useState('');
  const [loadingOffices, setLoadingOffices] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);

  const office = offices.find((o) => o.id === officeId) || null;

  // Reset al abrir.
  useEffect(() => {
    if (!open) return;
    setNombre(contactName || '');
    setOfficeId(''); setProfesionalId(''); setSlots([]); setSlotIdx(null);
    setMotivo(''); setNota('');
    setLoadingOffices(true);
    availabilityApi.offices(accountId)
      .then((os) => setOffices(os))
      .catch((e) => toast.error(e?.message || 'No se pudieron cargar las oficinas'))
      .finally(() => setLoadingOffices(false));
  }, [open, accountId, contactName]);

  // Cargar slots cuando cambia oficina o profesional.
  const loadSlots = useCallback(() => {
    if (!office) { setSlots([]); return; }
    setLoadingSlots(true);
    setSlotIdx(null);
    availabilityApi.slots(accountId, office.nombre, profesionalId || null)
      .then((s) => setSlots(s))
      .catch((e) => toast.error(e?.message || 'No se pudieron cargar los horarios'))
      .finally(() => setLoadingSlots(false));
  }, [accountId, office, profesionalId]);

  useEffect(() => { if (open && office) loadSlots(); }, [open, office, profesionalId, loadSlots]);

  if (!open) return null;

  const submit = async () => {
    if (!nombre.trim()) return toast.error('Falta el nombre');
    if (!office) return toast.error('Elegí una oficina');
    if (slotIdx === null || !slots[slotIdx]) return toast.error('Elegí un horario');
    const slot = slots[slotIdx];
    setSaving(true);
    try {
      await appointmentsApi.create({
        account_id: accountId,
        phone,
        telefono: phone,
        nombre: nombre.trim(),
        resumen: nota.trim(),
        status: 'pendiente',
        start_time: slot.start,
        end_time: slot.end,
        oficina: office.nombre,
        assigned_profile_id: profesionalId || null,
        motivo: motivo || null,
        canal_origen: 'whatsapp',
      } as any);
      toast.success('Cita agendada');
      onBooked?.();
      onClose();
    } catch (e: any) {
      toast.error(e?.message || 'No se pudo agendar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md max-h-[90vh] overflow-y-auto rounded-2xl bg-brand-surface border border-brand-hairline shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-hairline sticky top-0 bg-brand-surface">
          <h3 className="font-serif font-bold text-brand-ink flex items-center gap-2">
            <Calendar size={18} className="text-brand-primary" /> Agendar cita
          </h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-brand-inkmuted hover:text-brand-ink">
            <X size={18} />
          </button>
        </div>

        <div className="px-5 py-4 space-y-3.5">
          {/* Nombre */}
          <label className="block">
            <span className="text-xs font-semibold text-brand-inkmuted">Nombre</span>
            <input
              value={nombre} onChange={(e) => setNombre(e.target.value)}
              className="mt-1 w-full rounded-lg border border-brand-hairline bg-brand-bg px-3 py-2 text-sm text-brand-ink"
            />
          </label>

          {/* Oficina */}
          <label className="block">
            <span className="text-xs font-semibold text-brand-inkmuted">Oficina / modalidad</span>
            <select
              value={officeId}
              onChange={(e) => { setOfficeId(e.target.value); setProfesionalId(''); }}
              disabled={loadingOffices}
              className="mt-1 w-full rounded-lg border border-brand-hairline bg-brand-bg px-3 py-2 text-sm text-brand-ink"
            >
              <option value="">{loadingOffices ? 'Cargando…' : 'Elegí una oficina'}</option>
              {offices.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
            </select>
          </label>

          {/* Profesional */}
          <label className="block">
            <span className="text-xs font-semibold text-brand-inkmuted">Profesional</span>
            <select
              value={profesionalId}
              onChange={(e) => setProfesionalId(e.target.value)}
              disabled={!office || (office.profesionales.length === 0)}
              className="mt-1 w-full rounded-lg border border-brand-hairline bg-brand-bg px-3 py-2 text-sm text-brand-ink disabled:opacity-50"
            >
              <option value="">Cualquiera</option>
              {office?.profesionales.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          {/* Slot */}
          <label className="block">
            <span className="text-xs font-semibold text-brand-inkmuted">Horario</span>
            <select
              value={slotIdx === null ? '' : String(slotIdx)}
              onChange={(e) => setSlotIdx(e.target.value === '' ? null : Number(e.target.value))}
              disabled={!office || loadingSlots}
              className="mt-1 w-full rounded-lg border border-brand-hairline bg-brand-bg px-3 py-2 text-sm text-brand-ink disabled:opacity-50"
            >
              <option value="">
                {!office ? 'Elegí una oficina primero'
                  : loadingSlots ? 'Cargando horarios…'
                  : slots.length === 0 ? 'Sin horarios disponibles'
                  : 'Elegí un horario'}
              </option>
              {slots.map((s, i) => <option key={s.start} value={i}>{slotLabel(s.start)}</option>)}
            </select>
          </label>

          {/* Motivo */}
          <label className="block">
            <span className="text-xs font-semibold text-brand-inkmuted">Motivo</span>
            <select
              value={motivo}
              onChange={(e) => setMotivo(e.target.value as AppointmentMotivo | '')}
              className="mt-1 w-full rounded-lg border border-brand-hairline bg-brand-bg px-3 py-2 text-sm text-brand-ink"
            >
              <option value="">Sin especificar</option>
              {(Object.keys(MOTIVO_LABELS) as AppointmentMotivo[]).map((m) =>
                <option key={m} value={m}>{MOTIVO_LABELS[m]}</option>)}
            </select>
          </label>

          {/* Nota */}
          <label className="block">
            <span className="text-xs font-semibold text-brand-inkmuted">Nota para el profesional</span>
            <textarea
              value={nota} onChange={(e) => setNota(e.target.value)} rows={2}
              className="mt-1 w-full rounded-lg border border-brand-hairline bg-brand-bg px-3 py-2 text-sm text-brand-ink resize-none"
              placeholder="Contexto del caso (opcional)"
            />
          </label>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-brand-hairline sticky bottom-0 bg-brand-surface">
          <button onClick={onClose} className="px-4 py-2 rounded-xl text-xs font-semibold text-brand-inkmuted hover:text-brand-ink">
            Cancelar
          </button>
          <button
            onClick={submit} disabled={saving}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold bg-brand-primary text-white hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Calendar size={14} />}
            Agendar
          </button>
        </div>
      </div>
    </div>
  );
}

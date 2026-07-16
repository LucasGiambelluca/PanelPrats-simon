import { useEffect, useState, useCallback } from 'react';
import { X, Calendar, Loader2, AlertTriangle } from 'lucide-react';
import { toast } from 'sonner';
import {
  availabilityApi, appointmentsApi, MOTIVO_LABELS,
  type AvailabilityOffice, type FreeSlot, type AppointmentMotivo,
} from '../lib/api';
import { esPsid } from '../lib/psid';

interface Props {
  open: boolean;
  onClose: () => void;
  accountId: string;
  phone: string;
  contactName: string;
  onBooked?: () => void;
}

// 'YYYY-MM-DD' en hora local (para <input type="date">).
function todayStr(): string {
  return new Date().toLocaleDateString('en-CA');
}

function timeLabel(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', hour12: false });
}

export default function BookFromChatModal({ open, onClose, accountId, phone, contactName, onBooked }: Props) {
  const [offices, setOffices] = useState<AvailabilityOffice[]>([]);
  const [officeId, setOfficeId] = useState('');
  const [profesionalId, setProfesionalId] = useState('');
  const [date, setDate] = useState(todayStr());
  const [slots, setSlots] = useState<FreeSlot[]>([]);
  const [selectedStart, setSelectedStart] = useState<string | null>(null);
  // En FB/IG contactName puede ser el PSID (id numérico de la red): no sirve como nombre.
  const [nombre, setNombre] = useState(esPsid(contactName) ? '' : (contactName || ''));
  const [motivo, setMotivo] = useState<AppointmentMotivo | ''>('');
  const [nota, setNota] = useState('');
  const [loadingOffices, setLoadingOffices] = useState(false);
  const [loadingSlots, setLoadingSlots] = useState(false);
  const [saving, setSaving] = useState(false);
  // Cita futura activa YA existente para este contacto (aviso anti-duplicado:
  // caso prod 9/7 — se re-agendaban a mano citas que el bot ya había creado).
  const [citaExistente, setCitaExistente] = useState<{ start_time: string; oficina?: string } | null>(null);

  const office = offices.find((o) => o.id === officeId) || null;

  // Reset al abrir.
  useEffect(() => {
    if (!open) return;
    setNombre(esPsid(contactName) ? '' : (contactName || ''));
    setOfficeId(''); setProfesionalId(''); setSlots([]); setSelectedStart(null);
    setDate(todayStr()); setMotivo(''); setNota('');
    setLoadingOffices(true);
    availabilityApi.offices(accountId)
      .then((os) => setOffices(os))
      .catch((e) => toast.error(e?.message || 'No se pudieron cargar las oficinas'))
      .finally(() => setLoadingOffices(false));
    // Chequeo best-effort de cita ya existente (si falla, no bloquea el modal).
    setCitaExistente(null);
    appointmentsApi.list(accountId)
      .then((apps: any[]) => {
        const now = Date.now();
        const vigente = apps
          .filter((a) => a.phone === phone
            && (a.status === 'pendiente' || a.status === 'confirmada')
            && a.start_time && new Date(a.start_time).getTime() > now)
          .sort((a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime())[0];
        if (vigente) setCitaExistente({ start_time: vigente.start_time, oficina: vigente.oficina });
      })
      .catch(() => { /* sin aviso, el modal funciona igual */ });
  }, [open, accountId, phone, contactName]);

  // Cargar slots del día elegido cuando cambia oficina / profesional / fecha.
  const loadSlots = useCallback(() => {
    if (!office) { setSlots([]); return; }
    setLoadingSlots(true);
    setSelectedStart(null);
    availabilityApi.slots(accountId, office.nombre, { profesional: profesionalId || null, date })
      .then((s) => setSlots(s))
      .catch((e) => toast.error(e?.message || 'No se pudieron cargar los horarios'))
      .finally(() => setLoadingSlots(false));
  }, [accountId, office, profesionalId, date]);

  useEffect(() => { if (open && office) loadSlots(); }, [open, office, profesionalId, date, loadSlots]);

  if (!open) return null;

  const submit = async () => {
    if (!nombre.trim()) return toast.error('Falta el nombre');
    if (!office) return toast.error('Elegí una oficina');
    const slot = slots.find((s) => s.start === selectedStart);
    if (!slot) return toast.error('Elegí un horario');
    setSaving(true);
    try {
      await appointmentsApi.create({
        account_id: accountId,
        phone,
        // En FB/IG `phone` es el PSID: no es un teléfono llamable (bug prod 16/7:
        // el recordatorio saludó "¡Hola, 27208676225498134!").
        telefono: esPsid(phone) ? null : phone,
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
          {/* Aviso anti-duplicado: el contacto ya tiene una cita futura activa */}
          {citaExistente && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span>
                Este contacto <b>ya tiene una cita</b> el{' '}
                <b>{new Date(citaExistente.start_time).toLocaleString('es-AR', { weekday: 'long', day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</b>
                {citaExistente.oficina ? <> en <b>{citaExistente.oficina}</b></> : null}.
                Si agendás acá, va a quedar <b>duplicada</b> — conviene reprogramar la existente desde la Agenda.
              </span>
            </div>
          )}
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

          {/* Fecha + grilla de horarios del día */}
          <div className="block">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-semibold text-brand-inkmuted">Fecha</span>
              <input
                type="date" value={date} min={todayStr()}
                onChange={(e) => setDate(e.target.value)}
                disabled={!office}
                className="rounded-lg border border-brand-hairline bg-brand-bg px-3 py-1.5 text-sm text-brand-ink disabled:opacity-50"
              />
            </div>
            <div className="mt-2 min-h-[44px]">
              {!office ? (
                <p className="text-xs text-brand-inkmuted py-2">Elegí una oficina para ver horarios.</p>
              ) : loadingSlots ? (
                <p className="text-xs text-brand-inkmuted py-2 flex items-center gap-2"><Loader2 size={13} className="animate-spin" /> Cargando horarios…</p>
              ) : slots.length === 0 ? (
                <p className="text-xs text-brand-inkmuted py-2">Sin horarios disponibles ese día.</p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5">
                  {slots.map((s) => {
                    const sel = s.start === selectedStart;
                    return (
                      <button
                        key={s.start} type="button"
                        onClick={() => setSelectedStart(s.start)}
                        className={`rounded-lg px-2 py-1.5 text-xs font-semibold border transition-all ${
                          sel
                            ? 'bg-brand-primary text-white border-brand-primary'
                            : 'bg-brand-bg text-brand-ink border-brand-hairline hover:border-brand-primary/50'
                        }`}
                      >
                        {timeLabel(s.start)}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

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

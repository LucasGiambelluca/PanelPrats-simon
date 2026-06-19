import { useEffect, useRef, useState } from 'react';
import { Appointment } from '../lib/api';
import CallActions from './CallActions';
import { X, Bell, Clock } from 'lucide-react';

interface Props {
  appointments: Appointment[];
  /** provider de la cuenta activa: 'official' habilita la llamada de voz por API de Meta */
  provider?: 'baileys' | 'official';
}

// Ventana de disparo: aparece desde 5 min antes hasta 3 min después del horario.
const FIRE_BEFORE_MIN = 5;
const FIRE_AFTER_MIN = 3;

function onlyDigits(s: string): string {
  return (s || '').replace(/\D/g, '');
}

function hhmm(iso?: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export default function CallReminderModal({ appointments, provider }: Props) {
  const [due, setDue] = useState<Appointment | null>(null);
  const [now, setNow] = useState<Date>(new Date());
  const dismissed = useRef<Set<string>>(new Set()); // ids ya mostrados/cerrados en esta sesión

  // Tick cada 20s para detectar citas que arrancan.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 20000);
    return () => clearInterval(t);
  }, []);

  // Detectar la próxima cita en ventana de disparo.
  useEffect(() => {
    if (due) return; // ya hay un popup abierto
    const nowMs = now.getTime();
    const candidate = appointments
      .filter(a => (a.status === 'pendiente' || a.status === 'confirmada') && a.start_time && !dismissed.current.has(a.id))
      .map(a => ({ a, mins: (new Date(a.start_time!).getTime() - nowMs) / 60000 }))
      .filter(({ mins }) => mins <= FIRE_BEFORE_MIN && mins >= -FIRE_AFTER_MIN)
      .sort((x, y) => x.mins - y.mins)[0];
    if (candidate) setDue(candidate.a);
  }, [now, appointments, due]);

  if (!due) return null;

  const phoneDigits = onlyDigits(due.telefono || due.phone);
  const oficina = (due.oficina || '').trim();

  const close = () => {
    if (due) dismissed.current.add(due.id);
    setDue(null);
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#243150] to-[#2f5fd0] p-5 text-white relative">
          <button onClick={close} className="absolute top-3 right-3 text-white/70 hover:text-white"><X size={18} /></button>
          <div className="flex items-center gap-2 mb-1">
            <Bell size={18} className="animate-pulse" />
            <span className="text-xs font-bold uppercase tracking-wider">Recordatorio de cita</span>
          </div>
          <h3 className="text-xl font-bold capitalize">{due.nombre || 'Cliente'}</h3>
          <div className="flex items-center gap-3 mt-1 text-sm text-white/90">
            <span className="flex items-center gap-1"><Clock size={14} /> {hhmm(due.start_time)} hs</span>
            {oficina && <span className="px-2 py-0.5 bg-white/15 rounded-full text-xs">{oficina}</span>}
          </div>
        </div>

        {/* Body */}
        <div className="p-5 space-y-3">
          {due.resumen && <p className="text-sm text-slate-600">{due.resumen}</p>}
          <p className="text-xs text-slate-400">Tel: {phoneDigits || '—'}</p>

          <CallActions
            target={{ account_id: due.account_id, phone: due.phone, telefono: due.telefono, nombre: due.nombre }}
            provider={provider}
          />

          <button onClick={close} className="w-full text-sm text-slate-500 hover:text-slate-700 pt-1">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

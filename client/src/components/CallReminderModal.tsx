import { useEffect, useRef, useState } from 'react';
import { Appointment, callsApi } from '../lib/api';
import { toast } from 'sonner';
import { Video, Phone, MessageCircle, X, Bell, Clock } from 'lucide-react';

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
  const [calling, setCalling] = useState(false);

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
  const isVideo = /video|llamada/i.test(oficina) || !oficina;

  const close = () => {
    if (due) dismissed.current.add(due.id);
    setDue(null);
  };

  const openWhatsApp = () => {
    if (!phoneDigits) { toast.error('La cita no tiene teléfono'); return; }
    window.open(`https://wa.me/${phoneDigits}`, '_blank');
  };

  const openMeet = () => {
    window.open('https://meet.google.com/new', '_blank');
    toast.info('Se abrió una sala de Google Meet. Compartí el enlace con el cliente.');
  };

  const voiceCall = async () => {
    if (provider !== 'official') return;
    setCalling(true);
    try {
      const res = await callsApi.voice(due.account_id, phoneDigits);
      if (res.status === 'initiated') toast.success('Llamada de voz iniciada.');
      else toast.warning(res.message || 'No se pudo iniciar la llamada.');
    } catch (e: any) {
      toast.error('Error al iniciar la llamada: ' + (e.message || ''));
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-fade-in">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden border border-slate-200">
        {/* Header */}
        <div className="bg-gradient-to-r from-[#304352] to-[#a57b5a] p-5 text-white relative">
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

          <div className="grid grid-cols-1 gap-2 pt-1">
            <button onClick={openWhatsApp}
              className="flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe5b] text-white font-semibold py-3 rounded-xl transition-colors">
              <MessageCircle size={18} /> Abrir WhatsApp {isVideo ? '(videollamada)' : ''}
            </button>

            <button onClick={openMeet}
              className="flex items-center justify-center gap-2 bg-[#1a73e8] hover:bg-[#1666d0] text-white font-semibold py-3 rounded-xl transition-colors">
              <Video size={18} /> Iniciar Google Meet
            </button>

            <button onClick={voiceCall} disabled={provider !== 'official' || calling}
              title={provider !== 'official' ? 'Requiere la API oficial de WhatsApp (Meta) con Calling habilitado' : ''}
              className="flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold py-3 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
              <Phone size={18} /> {calling ? 'Llamando…' : 'Llamada de voz (API oficial)'}
            </button>
            {provider !== 'official' && (
              <p className="text-[11px] text-slate-400 text-center -mt-1">La llamada de voz requiere API oficial de Meta con Calling habilitado.</p>
            )}
          </div>

          <button onClick={close} className="w-full text-sm text-slate-500 hover:text-slate-700 pt-1">Cerrar</button>
        </div>
      </div>
    </div>
  );
}

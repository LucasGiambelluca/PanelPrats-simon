import { useState } from 'react';
import { callsApi, messagesApi, salasApi } from '../lib/api';
import { toast } from 'sonner';
import { Video, Phone, MessageCircle, Send, MonitorPlay } from 'lucide-react';

interface CallTarget {
  account_id: string;
  phone?: string;
  telefono?: string;
  nombre?: string;
}

interface Props {
  target: CallTarget;
  provider?: 'baileys' | 'official';
  compact?: boolean;
}

function onlyDigits(s?: string): string {
  return (s || '').replace(/\D/g, '');
}

export default function CallActions({ target, provider }: Props) {
  const [calling, setCalling] = useState(false);
  const [meetLink, setMeetLink] = useState('');
  const [sending, setSending] = useState(false);
  const [startingSala, setStartingSala] = useState(false);

  const phoneDigits = onlyDigits(target.telefono || target.phone);

  // Crea una sala de video (Jitsi), manda el link al cliente por WhatsApp y entra como host.
  const startSala = async () => {
    setStartingSala(true);
    try {
      const sala = await salasApi.create({ account_id: target.account_id, titulo: target.nombre });
      // Abrir la sala del operador SIEMPRE (no depende del envío al cliente).
      window.open(`/sala/${sala.id}?host=1`, '_blank');

      const inv = await salasApi.invitar(sala.id, target.nombre || 'Cliente');
      if (phoneDigits) {
        try {
          await messagesApi.send(
            target.account_id,
            phoneDigits,
            `Te esperamos en tu *videollamada* con el estudio 👇 Entrá con este link (1 solo click, sin instalar nada):\n${inv.enlace}`
          );
          toast.success('Sala creada y link enviado al cliente por WhatsApp ✅');
        } catch (e: any) {
          await navigator.clipboard?.writeText(inv.enlace).catch(() => {});
          toast.warning('Sala lista, pero no se pudo enviar por WhatsApp. El link se copió — pasáselo al cliente.');
        }
      } else {
        await navigator.clipboard?.writeText(inv.enlace).catch(() => {});
        toast.info('Sala lista. Link copiado al portapapeles (la cita no tiene teléfono).');
      }
    } catch (e: any) {
      toast.error('No se pudo iniciar la videollamada: ' + (e.message || ''));
    } finally {
      setStartingSala(false);
    }
  };

  const openWhatsApp = () => {
    if (!phoneDigits) { toast.error('La cita no tiene teléfono'); return; }
    window.open(`https://wa.me/${phoneDigits}`, '_blank');
  };

  const openMeet = () => {
    window.open('https://meet.google.com/new', '_blank');
    toast.info('Se abrió Google Meet. Copiá el link de la sala y pegalo abajo para enviárselo al cliente.');
  };

  const sendMeetLink = async () => {
    const link = meetLink.trim();
    if (!/meet\.google\.com\//.test(link)) { toast.error('Pegá un link válido de Google Meet'); return; }
    if (!phoneDigits) { toast.error('La cita no tiene teléfono'); return; }
    setSending(true);
    try {
      const nombre = (target.nombre || '').split(' ')[0] || '';
      const msg = `Hola ${nombre}! 👋 Te esperamos en tu *videollamada* con el estudio. Ingresá por este link a la hora de la cita:\n${link}`;
      await messagesApi.send(target.account_id, phoneDigits, msg);
      toast.success('Link de Meet enviado al cliente por WhatsApp ✅');
      setMeetLink('');
    } catch (e: any) {
      toast.error('No se pudo enviar el link: ' + (e.message || ''));
    } finally {
      setSending(false);
    }
  };

  const voiceCall = async () => {
    if (provider !== 'official') return;
    setCalling(true);
    try {
      const res = await callsApi.voice(target.account_id, phoneDigits);
      if (res.status === 'initiated') toast.success('Llamada de voz iniciada.');
      else toast.warning(res.message || 'No se pudo iniciar la llamada.');
    } catch (e: any) {
      toast.error('Error al iniciar la llamada: ' + (e.message || ''));
    } finally {
      setCalling(false);
    }
  };

  return (
    <div className="space-y-2">
      {/* Videollamada por sala (Jitsi): crea sala, manda link al cliente, entra como host */}
      <button onClick={startSala} disabled={startingSala}
        className="w-full flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3 rounded-xl transition-colors disabled:opacity-50">
        <MonitorPlay size={18} /> {startingSala ? 'Creando sala…' : 'Iniciar videollamada + enviar link'}
      </button>

      <button onClick={openWhatsApp}
        className="w-full flex items-center justify-center gap-2 bg-[#25D366] hover:bg-[#1ebe5b] text-white font-semibold py-2.5 rounded-xl transition-colors">
        <MessageCircle size={17} /> Abrir WhatsApp
      </button>

      <button onClick={openMeet}
        className="w-full flex items-center justify-center gap-2 bg-[#1a73e8] hover:bg-[#1666d0] text-white font-semibold py-2.5 rounded-xl transition-colors">
        <Video size={17} /> Iniciar Google Meet
      </button>

      {/* Enviar el link de Meet al cliente por WhatsApp */}
      <div className="flex gap-2">
        <input
          value={meetLink}
          onChange={e => setMeetLink(e.target.value)}
          placeholder="Pegá el link de Meet…"
          className="flex-1 bg-slate-100 border border-slate-200 rounded-xl px-3 py-2 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-200"
        />
        <button onClick={sendMeetLink} disabled={sending || !meetLink.trim()}
          title="Enviar el link de Meet al cliente por WhatsApp"
          className="flex items-center gap-1.5 bg-slate-700 hover:bg-slate-800 text-white text-sm font-semibold px-3 rounded-xl transition-colors disabled:opacity-40">
          <Send size={15} /> {sending ? '…' : 'Enviar'}
        </button>
      </div>

      <button onClick={voiceCall} disabled={provider !== 'official' || calling}
        title={provider !== 'official' ? 'Requiere la API oficial de WhatsApp (Meta) con Calling habilitado' : ''}
        className="w-full flex items-center justify-center gap-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed">
        <Phone size={17} /> {calling ? 'Llamando…' : 'Llamada de voz (API oficial)'}
      </button>
      {provider !== 'official' && (
        <p className="text-[11px] text-slate-400 text-center -mt-1">La llamada de voz requiere API oficial de Meta con Calling habilitado.</p>
      )}
    </div>
  );
}

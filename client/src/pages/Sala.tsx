import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import DailyIframe, { DailyCall } from '@daily-co/daily-js';
import { salasApi } from '../lib/api';
import { Loader2, VideoOff, AlertTriangle, PhoneOff } from 'lucide-react';

type Estado = 'loading' | 'in-call' | 'ended' | 'error';
type ErrorKind = 'expired' | 'invalid' | 'camera' | 'generic';

export default function Sala() {
  const { salaId } = useParams();
  const [params] = useSearchParams();
  const invite = params.get('invite');
  const host = params.get('host');

  const containerRef = useRef<HTMLDivElement>(null);
  const frameRef = useRef<DailyCall | null>(null);
  const startedRef = useRef(false); // evita doble init (StrictMode)

  const [estado, setEstado] = useState<Estado>('loading');
  const [errorKind, setErrorKind] = useState<ErrorKind>('generic');
  const [nombre, setNombre] = useState('');

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    (async () => {
      if (!salaId) { setErrorKind('invalid'); setEstado('error'); return; }
      try {
        const creds = invite
          ? await salasApi.join(salaId, invite)
          : host
            ? await salasApi.hostToken(salaId, 'Operador')
            : null;
        if (!creds) { setErrorKind('invalid'); setEstado('error'); return; }
        setNombre(creds.displayName);

        if (!containerRef.current) return;
        const frame = DailyIframe.createFrame(containerRef.current, {
          showLeaveButton: true,
          iframeStyle: { width: '100%', height: '100%', border: '0' },
        });
        frameRef.current = frame;

        frame.on('left-meeting', () => setEstado('ended'));
        frame.on('camera-error', () => { setErrorKind('camera'); setEstado('error'); });
        frame.on('error', () => { setErrorKind('generic'); setEstado('error'); });

        await frame.join({ url: creds.roomUrl, token: creds.dailyToken });
        setEstado('in-call');
      } catch (e: any) {
        const m = String(e?.message || '');
        setErrorKind(m === 'EXPIRED' ? 'expired' : m === 'INVALID' ? 'invalid' : 'generic');
        setEstado('error');
      }
    })();

    return () => { frameRef.current?.destroy().catch(() => {}); frameRef.current = null; };
  }, [salaId, invite, host]);

  const overlayMsg: Record<ErrorKind, [string, string]> = {
    expired: ['Este enlace ya no es válido', 'Pedile al estudio un enlace nuevo para tu videollamada.'],
    invalid: ['Enlace incorrecto', 'Revisá el enlace que te enviaron o pedí uno nuevo.'],
    camera: ['No pudimos usar la cámara', 'Permití el acceso a la cámara y el micrófono en tu navegador y volvé a abrir el enlace.'],
    generic: ['Hubo un problema', 'Volvé a abrir el enlace en un momento. Si sigue, pedí uno nuevo.'],
  };
  const ErrIcon = errorKind === 'camera' ? VideoOff : AlertTriangle;

  return (
    <div className="h-screen w-screen bg-black flex flex-col relative">
      <div className="bg-slate-900 text-white px-4 py-2 text-center text-sm font-semibold flex-shrink-0">
        Videollamada con el estudio Prats &amp; Simon{nombre ? ` — ${nombre}` : ''}
      </div>
      {/* Container de Daily — SIEMPRE montado para poder iniciar el frame */}
      <div ref={containerRef} className="flex-1 min-h-0" />

      {/* Overlays según estado */}
      {estado === 'loading' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 p-6 text-center">
          <div className="max-w-sm">
            <Loader2 size={48} className="text-emerald-400 animate-spin mx-auto mb-4" />
            <p className="text-white text-xl">Conectando a la videollamada…</p>
            <p className="text-slate-400 text-base mt-2">Permití el acceso a la cámara y el micrófono.</p>
          </div>
        </div>
      )}
      {estado === 'ended' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 p-6 text-center">
          <div className="max-w-sm">
            <PhoneOff size={48} className="text-slate-400 mx-auto mb-4" />
            <p className="text-white text-2xl font-bold">Llamada finalizada</p>
            <p className="text-slate-400 text-base mt-2">Ya podés cerrar esta ventana. ¡Gracias!</p>
          </div>
        </div>
      )}
      {estado === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 p-6 text-center">
          <div className="max-w-sm">
            <ErrIcon size={48} className="text-amber-400 mx-auto mb-4" />
            <p className="text-white text-2xl font-bold">{overlayMsg[errorKind][0]}</p>
            <p className="text-slate-300 text-lg mt-3 leading-relaxed">{overlayMsg[errorKind][1]}</p>
          </div>
        </div>
      )}
    </div>
  );
}

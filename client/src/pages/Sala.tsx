import { useEffect, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { salasApi } from '../lib/api';
import { Loader2, VideoOff, AlertTriangle, PhoneOff } from 'lucide-react';

type Estado = 'loading' | 'in-call' | 'ended' | 'error';
type ErrorKind = 'expired' | 'invalid' | 'camera' | 'generic';

// Guard a nivel módulo: evita doble-init (StrictMode / re-render).
let salaIniciada = false;

function loadJitsiScript(domain: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if ((window as any).JitsiMeetExternalAPI) return resolve();
    const s = document.createElement('script');
    s.src = `https://${domain}/external_api.js`;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('No se pudo cargar el video'));
    document.body.appendChild(s);
  });
}

export default function Sala() {
  const { salaId } = useParams();
  const [params] = useSearchParams();
  const invite = params.get('invite');
  const host = params.get('host');

  const containerRef = useRef<HTMLDivElement>(null);
  const apiRef = useRef<any>(null);

  const [estado, setEstado] = useState<Estado>('loading');
  const [errorKind, setErrorKind] = useState<ErrorKind>('generic');
  const [nombre, setNombre] = useState('');
  const [debug, setDebug] = useState('');

  useEffect(() => {
    if (salaIniciada || apiRef.current) return;
    salaIniciada = true;

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

        const domain = new URL(creds.roomUrl).host; // meet.jit.si
        await loadJitsiScript(domain);
        if (!containerRef.current) return;

        const api = new (window as any).JitsiMeetExternalAPI(domain, {
          roomName: creds.room,
          parentNode: containerRef.current,
          width: '100%',
          height: '100%',
          userInfo: { displayName: creds.displayName },
          configOverwrite: {
            prejoinPageEnabled: false,     // 1 click, sin pantalla previa
            startWithAudioMuted: false,
            startWithVideoMuted: false,
            disableDeepLinking: true,      // mobile: no redirige a la app, queda en el browser
          },
          interfaceConfigOverwrite: {
            MOBILE_APP_PROMO: false,
            SHOW_JITSI_WATERMARK: false,
            SHOW_CHROME_EXTENSION_BANNER: false,
          },
        });
        apiRef.current = api;

        // Revelar el iframe de Jitsi YA (su propio "conectando"/UI va adentro).
        // No esperar videoConferenceJoined, que a veces no llega y deja el spinner.
        setEstado('in-call');

        api.on('videoConferenceJoined', () => setEstado('in-call'));
        api.on('readyToClose', () => setEstado('ended'));
        api.on('videoConferenceLeft', () => setEstado('ended'));
        api.on('errorOccurred', (e: any) => { console.warn('[Sala] jitsi error', e); setDebug('jitsi: ' + JSON.stringify(e)); });
      } catch (e: any) {
        console.error('[Sala] catch', e);
        const m = String(e?.message || '');
        setErrorKind(m === 'EXPIRED' ? 'expired' : m === 'INVALID' ? 'invalid' : 'generic');
        setDebug(m);
        setEstado('error');
      }
    })();
  }, [salaId, invite, host]);

  const overlayMsg: Record<ErrorKind, [string, string]> = {
    expired: ['Este enlace ya no es válido', 'Pedile al estudio un enlace nuevo para tu videollamada.'],
    invalid: ['Enlace incorrecto', 'Revisá el enlace que te enviaron o pedí uno nuevo.'],
    camera: ['No pudimos usar la cámara', 'Permití el acceso a la cámara y el micrófono en tu navegador.'],
    generic: ['Hubo un problema', 'Volvé a abrir el enlace en un momento. Si sigue, pedí uno nuevo.'],
  };
  const ErrIcon = errorKind === 'camera' ? VideoOff : AlertTriangle;

  return (
    <div className="h-screen w-screen bg-black flex flex-col relative">
      <div className="bg-slate-900 text-white px-4 py-2 text-center text-sm font-semibold flex-shrink-0">
        Videollamada con el estudio Prats &amp; Simon{nombre ? ` — ${nombre}` : ''}
      </div>
      <div ref={containerRef} className="flex-1 min-h-0" />

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
            {debug && <p className="text-amber-400/70 text-xs mt-4 break-words font-mono">debug: {debug}</p>}
          </div>
        </div>
      )}
      {estado === 'error' && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900 p-6 text-center">
          <div className="max-w-sm">
            <ErrIcon size={48} className="text-amber-400 mx-auto mb-4" />
            <p className="text-white text-2xl font-bold">{overlayMsg[errorKind][0]}</p>
            <p className="text-slate-300 text-lg mt-3 leading-relaxed">{overlayMsg[errorKind][1]}</p>
            {debug && <p className="text-amber-400/70 text-xs mt-4 break-words font-mono">debug: {debug}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

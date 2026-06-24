import { useEffect, useState, useRef, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { QrCode, CheckCircle, ArrowLeft, Smartphone, Loader2, WifiOff, RefreshCw, Facebook, Instagram } from 'lucide-react';
import { accountsApi, apiBase } from '../lib/api';
import { useAccounts } from '../context/AccountContext';
import { CopyButton, metaWebhookUrl } from '../components/CopyButton';
import { toast } from 'sonner';

export default function WhatsAppConnect() {
  const { id } = useParams<{ id: string }>();
  const { accounts, reload } = useAccounts();
  const account = accounts.find((a) => a.id === id);
  const isMeta = !!account?.channel && account.channel !== 'whatsapp';
  const [status, setStatus] = useState<string>('disconnected');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const pollQr = useCallback(async () => {
    if (!id) return;
    try {
      const res = await accountsApi.qr(id);
      setStatus(res.status);

      if (res.status === 'connected') {
        setQrDataUrl(null);
        stopPolling();
        toast.success('¡WhatsApp conectado!');
        reload();
      } else if (res.qr) {
        // The backend returns a raw QR string; we generate a data URL
        setQrDataUrl(res.qr);
      }
    } catch (err) {
      console.error('[WhatsAppConnect] poll error:', err);
    }
  }, [id, stopPolling, reload]);

  const startConnect = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setQrDataUrl(null);

    try {
      const res = await accountsApi.connect(id);
      setStatus(res.status);
      // Start polling for QR / status every 2s
      stopPolling();
      pollRef.current = setInterval(pollQr, 2000);
      // Also do an immediate poll
      await pollQr();
    } catch (err: any) {
      toast.error('Error al conectar: ' + (err.message || 'desconocido'));
      setStatus('disconnected');
    }
    setLoading(false);
  }, [id, pollQr, stopPolling]);

  // On mount: check current status
  useEffect(() => {
    if (!id) return;
    (async () => {
      try {
        const res = await accountsApi.status(id);
        setStatus(res.status);
        if (res.status === 'qr' || res.status === 'connecting') {
          // Already connecting — start polling
          pollRef.current = setInterval(pollQr, 2000);
          await pollQr();
        }
      } catch {
        setStatus('disconnected');
      }
    })();

    return stopPolling;
  }, [id, pollQr, stopPolling]);

  const handleDisconnect = async () => {
    if (!id) return;
    try {
      await accountsApi.disconnect(id);
      setStatus('disconnected');
      setQrDataUrl(null);
      stopPolling();
      toast.info('Cuenta desconectada');
      reload();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f1a] p-8">
      <div className="max-w-lg mx-auto">
        <Link to="/accounts" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-300 text-sm mb-8 transition-colors">
          <ArrowLeft size={16} />
          Volver a Cuentas
        </Link>

        {isMeta ? (
          <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-8">
            <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-xl ${
              account?.channel === 'instagram'
                ? 'bg-gradient-to-br from-pink-500 to-purple-600 shadow-pink-500/20'
                : 'bg-gradient-to-br from-blue-500 to-blue-700 shadow-blue-500/20'
            }`}>
              {account?.channel === 'instagram'
                ? <Instagram size={28} className="text-white" />
                : <Facebook size={28} className="text-white" />}
            </div>

            <h2 className="text-2xl font-bold text-white mb-2 text-center">
              Conectar {account?.channel === 'instagram' ? 'Instagram' : 'Facebook'}
            </h2>
            <p className="text-slate-500 text-sm mb-8 text-center">
              Configurá el webhook en tu app de Meta
            </p>

            <div className="space-y-3 text-left">
              <div>
                <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wide mb-1">Webhook URL (Callback URL)</p>
                <div className="flex items-stretch gap-2">
                  <code className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-emerald-400 text-xs font-mono break-all">
                    {metaWebhookUrl(apiBase)}
                  </code>
                  <CopyButton value={metaWebhookUrl(apiBase)} label="Webhook URL" className="border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10" />
                </div>
              </div>
              <div>
                <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wide mb-1">Verify Token</p>
                {account?.verify_token ? (
                  <div className="flex items-stretch gap-2">
                    <code className="flex-1 bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-amber-400 text-xs font-mono break-all">
                      {account.verify_token}
                    </code>
                    <CopyButton value={account.verify_token} label="Verify Token" className="border-white/10 bg-white/5 text-slate-300 hover:text-white hover:bg-white/10" />
                  </div>
                ) : (
                  <code className="block bg-black/30 border border-white/10 rounded-lg px-3 py-2 text-slate-500 text-xs font-mono break-all">
                    — Definí un Verify Token al configurar la cuenta
                  </code>
                )}
              </div>
              <p className="text-slate-500 text-xs leading-relaxed">
                Pegá la Webhook URL y el Verify Token en la configuración de tu app de Meta.
                Una vez que Meta verifique el webhook, los mensajes llegarán automáticamente al inbox.
              </p>
            </div>
          </div>
        ) : (
        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-500/20">
            <Smartphone size={28} className="text-white" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">Conectar WhatsApp</h2>
          <p className="text-slate-500 text-sm mb-8">
            Vinculá un número de WhatsApp con tu cuenta
          </p>

          {/* CONNECTING / LOADING */}
          {(status === 'connecting' || loading) && !qrDataUrl && (
            <div className="space-y-4">
              <Loader2 size={48} className="text-indigo-400 mx-auto animate-spin" />
              <p className="text-slate-400 text-sm">Generando código QR…</p>
            </div>
          )}

          {/* QR CODE */}
          {(status === 'qr' || qrDataUrl) && status !== 'connected' && (
            <div className="space-y-6">
              {qrDataUrl ? (
                <div className="w-72 h-72 mx-auto bg-white rounded-2xl p-3 shadow-lg shadow-white/5 relative overflow-hidden">
                  <img
                    src={qrDataUrl.startsWith('data:') ? qrDataUrl : `data:image/png;base64,${qrDataUrl}`}
                    alt="WhatsApp QR Code"
                    className="w-full h-full object-contain rounded-xl"
                  />
                  {/* Scan line animation */}
                  <div className="absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scan-line" />
                </div>
              ) : (
                <div className="w-72 h-72 mx-auto bg-white rounded-2xl p-4 flex items-center justify-center">
                  <QrCode size={120} className="text-slate-300 animate-pulse" />
                </div>
              )}

              <div className="space-y-2">
                <p className="text-slate-300 text-sm font-medium">Escaneá el QR con WhatsApp</p>
                <p className="text-slate-600 text-xs">
                  Abrí WhatsApp → <span className="text-slate-400">Dispositivos vinculados</span> → <span className="text-slate-400">Vincular dispositivo</span>
                </p>
                <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-1.5 mt-2">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-amber-400 text-xs font-medium">Esperando escaneo…</span>
                </div>
              </div>
            </div>
          )}

          {/* CONNECTED */}
          {status === 'connected' && (
            <div className="space-y-4">
              <div className="w-20 h-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center mx-auto">
                <CheckCircle size={40} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-emerald-400 font-bold text-lg">¡Conectado!</p>
                <p className="text-slate-500 text-sm mt-1">El número está vinculado y listo para operar.</p>
              </div>
              <div className="flex items-center justify-center gap-3 mt-4">
                <Link
                  to="/inbox"
                  className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg shadow-indigo-600/20 hover:from-indigo-500 hover:to-purple-500 transition-all duration-200 hover:-translate-y-0.5"
                >
                  Ir al Inbox
                </Link>
                <button
                  onClick={handleDisconnect}
                  className="inline-flex items-center gap-2 bg-red-500/10 text-red-400 border border-red-500/20 px-6 py-3 rounded-xl font-bold text-sm hover:bg-red-500/20 transition-all duration-200"
                >
                  <WifiOff size={16} />
                  Desconectar
                </button>
              </div>
            </div>
          )}

          {/* DISCONNECTED */}
          {status === 'disconnected' && !loading && (
            <div className="space-y-4">
              <WifiOff size={48} className="text-slate-600 mx-auto" />
              <p className="text-slate-500 text-sm">Desconectado</p>
              <button
                onClick={startConnect}
                className="inline-flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg shadow-emerald-600/20 hover:from-emerald-500 hover:to-teal-500 transition-all duration-200 hover:-translate-y-0.5"
              >
                <RefreshCw size={16} />
                Iniciar Conexión
              </button>
            </div>
          )}
        </div>
        )}
      </div>
    </div>
  );
}

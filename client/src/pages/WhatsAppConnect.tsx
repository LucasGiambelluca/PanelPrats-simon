import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { QrCode, CheckCircle, ArrowLeft, Smartphone, Loader2 } from 'lucide-react';
import { api } from '../lib/api';

export default function WhatsAppConnect() {
  const { id } = useParams();
  const [status, setStatus] = useState<string>('connecting');
  const [qr, setQr] = useState<string | null>(null);

  // Real flow: trigger connect on the backend, then poll the QR/status endpoint.
  useEffect(() => {
    if (!id) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;

    // Kick off the Baileys connection.
    api(`/api/accounts/${id}/connect`, { method: 'POST' }).catch(() => {});

    const poll = async () => {
      if (stop) return;
      try {
        const r = await api<{ qr: string | null; status: string }>(`/api/accounts/${id}/qr`);
        if (stop) return;
        setQr(r.qr);
        setStatus(r.status);
        if (r.status === 'connected') return; // done, stop polling
      } catch {
        /* swallow and retry */
      }
      timer = setTimeout(poll, 2500);
    };

    poll();
    return () => { stop = true; clearTimeout(timer); };
  }, [id]);

  return (
    <div className="min-h-screen bg-[#0b0f1a] p-8">
      <div className="max-w-lg mx-auto">
        {/* Back */}
        <Link to="/accounts" className="inline-flex items-center gap-2 text-slate-500 hover:text-slate-300 text-sm mb-8 transition-colors">
          <ArrowLeft size={16} />
          Volver a Cuentas
        </Link>

        <div className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-3xl p-8 text-center">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center mx-auto mb-6 shadow-xl shadow-emerald-500/20">
            <Smartphone size={28} className="text-white" />
          </div>

          <h2 className="text-2xl font-bold text-white mb-2">Conectar WhatsApp</h2>
          <p className="text-slate-500 text-sm mb-8">
            Vinculá un número de WhatsApp con tu cuenta
          </p>

          {/* Status display */}
          {status === 'connected' ? (
            <div className="space-y-4">
              <div className="w-20 h-20 rounded-full bg-emerald-500/10 border-2 border-emerald-500/30 flex items-center justify-center mx-auto">
                <CheckCircle size={40} className="text-emerald-400" />
              </div>
              <div>
                <p className="text-emerald-400 font-bold text-lg">¡Conectado!</p>
                <p className="text-slate-500 text-sm mt-1">El número está vinculado y listo para operar.</p>
              </div>
              <Link
                to="/inbox"
                className="inline-flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg shadow-indigo-600/20 hover:from-indigo-500 hover:to-purple-500 transition-all duration-200 hover:-translate-y-0.5 mt-4"
              >
                Ir al Inbox
              </Link>
            </div>
          ) : qr ? (
            <div className="space-y-6">
              {/* Real QR Code (data URL served by backend) */}
              <div className="w-64 h-64 mx-auto bg-white rounded-2xl p-4 shadow-lg shadow-white/5 relative overflow-hidden">
                <img src={qr} alt="Código QR de WhatsApp" className="w-full h-full object-contain rounded-xl" />
                {/* Scan line animation */}
                <div className="absolute left-4 right-4 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scan-line" />
              </div>

              <div className="space-y-2">
                <p className="text-slate-300 text-sm font-medium">Escaneá el QR con WhatsApp</p>
                <p className="text-slate-600 text-xs">
                  Abrí WhatsApp → <span className="text-slate-400">Dispositivos vinculados</span> → <span className="text-slate-400">Vincular dispositivo</span>
                </p>
                <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-1.5 mt-2">
                  <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                  <span className="text-amber-400 text-xs font-medium">
                    Esperando escaneo…
                  </span>
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <Loader2 size={48} className="text-indigo-400 mx-auto animate-spin" />
              <p className="text-slate-400 text-sm">Generando código QR…</p>
              <div className="inline-flex items-center gap-2 text-slate-600 text-xs">
                <QrCode size={14} />
                <span>Estado: {status}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

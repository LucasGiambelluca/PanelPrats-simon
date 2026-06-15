import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { QrCode, CheckCircle, ArrowLeft, Smartphone, Loader2 } from 'lucide-react';

export default function WhatsAppConnect() {
  const { id } = useParams();
  const [status, setStatus] = useState<string>('disconnected');
  const [countdown, setCountdown] = useState(0);

  // Mock: simulate QR generation and connection flow
  useEffect(() => {
    if (!id) return;
    let stop = false;

    // Simulate connection flow
    const simulate = async () => {
      setStatus('connecting');
      await new Promise(r => setTimeout(r, 1500));
      if (stop) return;
      setStatus('qr');
      setCountdown(30);
    };

    simulate();
    return () => { stop = true; };
  }, [id]);

  // Countdown timer for QR expiry simulation
  useEffect(() => {
    if (status !== 'qr' || countdown <= 0) return;
    const timer = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          setStatus('connected');
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [status, countdown]);

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
          {status === 'connecting' && (
            <div className="space-y-4">
              <Loader2 size={48} className="text-indigo-400 mx-auto animate-spin" />
              <p className="text-slate-400 text-sm">Generando código QR…</p>
            </div>
          )}

          {status === 'qr' && (
            <div className="space-y-6">
              {/* Mock QR Code */}
              <div className="w-64 h-64 mx-auto bg-white rounded-2xl p-4 shadow-lg shadow-white/5 relative overflow-hidden">
                <div className="w-full h-full bg-gradient-to-br from-slate-100 to-slate-200 rounded-xl flex items-center justify-center relative">
                  <QrCode size={140} className="text-slate-800" />
                  <div className="absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-white/60" />
                </div>
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
                    Demo: se conectará en {countdown}s
                  </span>
                </div>
              </div>
            </div>
          )}

          {status === 'connected' && (
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
          )}

          {status === 'disconnected' && (
            <div className="space-y-4">
              <p className="text-slate-500 text-sm">Estado: desconectado</p>
              <button
                onClick={() => setStatus('connecting')}
                className="bg-gradient-to-r from-emerald-600 to-teal-600 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg transition-all"
              >
                Iniciar Conexión
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

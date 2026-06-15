import { useState, useEffect, useRef, useCallback } from 'react';
import { useAccounts } from '../context/AccountContext';
import { accountsApi } from '../lib/api';
import { toast } from 'sonner';
import {
  Plus, Wifi, WifiOff, QrCode, Loader2, Smartphone,
  RefreshCw, X, CheckCircle, Signal, PhoneOff
} from 'lucide-react';

const statusConfig: Record<string, { color: string; dotColor: string; icon: any; label: string }> = {
  connected:    { color: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20', dotColor: 'bg-emerald-400', icon: Wifi, label: 'Conectado' },
  disconnected: { color: 'bg-slate-400/10 text-slate-400 border-slate-400/20', dotColor: 'bg-slate-500', icon: WifiOff, label: 'Desconectado' },
  qr:           { color: 'bg-amber-400/10 text-amber-400 border-amber-400/20', dotColor: 'bg-amber-400', icon: QrCode, label: 'Esperando QR' },
  connecting:   { color: 'bg-blue-400/10 text-blue-400 border-blue-400/20', dotColor: 'bg-blue-400', icon: Loader2, label: 'Conectando…' },
};

export default function Accounts() {
  const { accounts, createAccount, reload } = useAccounts();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      await createAccount(name.trim());
      setName('');
      toast.success('Cuenta creada');
    } catch (err: any) {
      toast.error('Error: ' + (err.message || 'No se pudo crear'));
    }
    setCreating(false);
  };

  const pollQr = useCallback(async (accountId: string) => {
    try {
      const res = await accountsApi.qr(accountId);
      setConnectStatus(res.status);

      if (res.status === 'connected') {
        stopPolling();
        setQrDataUrl(null);
        toast.success('¡WhatsApp conectado!');
        reload();
        setTimeout(() => setConnectingId(null), 1500);
      } else if (res.qr) {
        setQrDataUrl(res.qr);
      }
    } catch (err) {
      console.error('[Accounts] poll error:', err);
    }
  }, [stopPolling, reload]);

  const handleConnect = async (accountId: string) => {
    setConnectingId(accountId);
    setQrDataUrl(null);
    setConnectStatus('connecting');

    try {
      await accountsApi.connect(accountId);
      stopPolling();
      pollRef.current = setInterval(() => pollQr(accountId), 2000);
      await pollQr(accountId);
    } catch (err: any) {
      toast.error('Error al conectar: ' + (err.message || ''));
      setConnectingId(null);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    try {
      await accountsApi.disconnect(accountId);
      toast.info('Cuenta desconectada');
      reload();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const closeQrPanel = () => {
    stopPolling();
    setConnectingId(null);
    setQrDataUrl(null);
  };

  return (
    <div className="min-h-screen bg-[#0b0f1a] p-6 lg:p-8">
      <div className="max-w-5xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Smartphone size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Mis Números</h1>
              <p className="text-sm text-slate-500">Conectá y administrá tus cuentas de WhatsApp</p>
            </div>
          </div>
          <button onClick={() => reload()} className="text-slate-500 hover:text-white transition-colors p-2 rounded-lg hover:bg-white/5">
            <RefreshCw size={18} />
          </button>
        </div>

        {/* Create Account */}
        <div className="bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-2xl p-5 mb-6">
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <Smartphone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" />
              <input
                className="w-full bg-black/20 border border-white/10 rounded-xl pl-11 pr-4 py-3.5 text-white text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
                placeholder="Nombre para la nueva cuenta (ej: Ventas, Soporte, Marketing…)"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              />
            </div>
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-7 py-3.5 rounded-xl font-bold text-sm shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-40 disabled:hover:translate-y-0 whitespace-nowrap"
            >
              <Plus size={16} />
              Nueva Cuenta
            </button>
          </div>
        </div>

        {/* Accounts Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {accounts.map((a) => {
            const cfg = statusConfig[a.status] || statusConfig.disconnected;
            const StatusIcon = cfg.icon;
            const isConnecting = connectingId === a.id;

            return (
              <div
                key={a.id}
                className={`bg-white/[0.03] backdrop-blur-sm border rounded-2xl overflow-hidden transition-all duration-300 ${
                  isConnecting
                    ? 'border-indigo-500/30 shadow-lg shadow-indigo-500/10 col-span-1 md:col-span-2 xl:col-span-3'
                    : 'border-white/10 hover:border-white/20 hover:bg-white/[0.05]'
                }`}
              >
                {/* Card Header */}
                <div className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center relative">
                        <Smartphone size={22} className="text-indigo-400" />
                        <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-[#0b0f1a] ${cfg.dotColor} ${
                          a.status === 'qr' || a.status === 'connecting' ? 'animate-pulse' : ''
                        }`} />
                      </div>
                      <div>
                        <h3 className="font-semibold text-white text-base">{a.name}</h3>
                        <p className="text-xs text-slate-500 font-mono mt-0.5">
                          {a.phone_number || 'Sin número'}
                        </p>
                      </div>
                    </div>
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border ${cfg.color}`}>
                      <StatusIcon size={11} className={a.status === 'connecting' ? 'animate-spin' : ''} />
                      {cfg.label}
                    </span>
                  </div>

                  {/* Action Buttons */}
                  <div className="flex gap-2 mt-4">
                    {a.status === 'connected' ? (
                      <button
                        onClick={() => handleDisconnect(a.id)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/15 text-red-400 text-xs font-semibold rounded-xl border border-red-500/20 transition-all duration-200"
                      >
                        <PhoneOff size={14} />
                        Desconectar
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(a.id)}
                        disabled={isConnecting}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-500/10 hover:bg-emerald-500/15 text-emerald-400 text-xs font-semibold rounded-xl border border-emerald-500/20 transition-all duration-200 disabled:opacity-50"
                      >
                        <Signal size={14} />
                        {isConnecting ? 'Conectando…' : 'Conectar WhatsApp'}
                      </button>
                    )}
                  </div>
                </div>

                {/* QR Panel (inline, expands when connecting) */}
                {isConnecting && (
                  <div className="border-t border-white/10 bg-gradient-to-b from-indigo-500/5 to-transparent p-6 animate-fade-in">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h4 className="text-white font-bold text-sm">Vincular WhatsApp</h4>
                        <p className="text-slate-500 text-xs mt-0.5">Escaneá el QR desde tu teléfono</p>
                      </div>
                      <button onClick={closeQrPanel} className="text-slate-500 hover:text-white transition-colors p-1">
                        <X size={18} />
                      </button>
                    </div>

                    <div className="flex flex-col md:flex-row items-center gap-6">
                      {/* QR Code */}
                      <div className="flex-shrink-0">
                        {connectStatus === 'connected' ? (
                          <div className="w-64 h-64 bg-emerald-500/10 rounded-2xl flex flex-col items-center justify-center gap-3">
                            <CheckCircle size={56} className="text-emerald-400" />
                            <p className="text-emerald-400 font-bold text-sm">¡Conectado!</p>
                          </div>
                        ) : qrDataUrl ? (
                          <div className="w-64 h-64 bg-white rounded-2xl p-3 shadow-lg shadow-white/5 relative overflow-hidden">
                            <img
                              src={qrDataUrl.startsWith('data:') ? qrDataUrl : `data:image/png;base64,${qrDataUrl}`}
                              alt="QR Code"
                              className="w-full h-full object-contain rounded-xl"
                            />
                            <div className="absolute left-3 right-3 h-0.5 bg-gradient-to-r from-transparent via-emerald-400 to-transparent animate-scan-line" />
                          </div>
                        ) : (
                          <div className="w-64 h-64 bg-white/5 rounded-2xl flex items-center justify-center border border-white/10">
                            <Loader2 size={40} className="text-indigo-400 animate-spin" />
                          </div>
                        )}
                      </div>

                      {/* Instructions */}
                      <div className="flex-1 space-y-4 text-center md:text-left">
                        <div className="space-y-3">
                          {[
                            { step: '1', text: 'Abrí WhatsApp en tu teléfono' },
                            { step: '2', text: 'Tocá ⋮ Menú → Dispositivos vinculados' },
                            { step: '3', text: 'Tocá "Vincular un dispositivo"' },
                            { step: '4', text: 'Apuntá la cámara al código QR' },
                          ].map((item) => (
                            <div key={item.step} className="flex items-center gap-3">
                              <div className="w-7 h-7 rounded-full bg-indigo-500/20 flex items-center justify-center flex-shrink-0">
                                <span className="text-indigo-400 text-xs font-bold">{item.step}</span>
                              </div>
                              <p className="text-slate-400 text-sm">{item.text}</p>
                            </div>
                          ))}
                        </div>

                        {qrDataUrl && (
                          <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-full px-4 py-2">
                            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-amber-400 text-xs font-medium">Esperando escaneo…</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Empty State */}
        {accounts.length === 0 && (
          <div className="text-center py-20">
            <div className="w-20 h-20 rounded-2xl bg-slate-800/50 flex items-center justify-center mx-auto mb-5">
              <Smartphone size={36} className="text-slate-600" />
            </div>
            <p className="text-slate-400 font-medium">No tenés cuentas de WhatsApp</p>
            <p className="text-slate-600 text-sm mt-1">Creá una arriba para empezar a conectar</p>
          </div>
        )}
      </div>
    </div>
  );
}

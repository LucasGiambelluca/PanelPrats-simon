import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccounts } from '../context/AccountContext';
import { Plus, Wifi, WifiOff, QrCode, Loader2, Smartphone } from 'lucide-react';

const statusConfig = {
  connected: { color: 'bg-emerald-400/10 text-emerald-400 border-emerald-400/20', icon: Wifi, label: 'Conectado' },
  disconnected: { color: 'bg-slate-400/10 text-slate-400 border-slate-400/20', icon: WifiOff, label: 'Desconectado' },
  qr: { color: 'bg-amber-400/10 text-amber-400 border-amber-400/20', icon: QrCode, label: 'Esperando QR' },
  connecting: { color: 'bg-blue-400/10 text-blue-400 border-blue-400/20', icon: Loader2, label: 'Conectando...' },
};

export default function Accounts() {
  const { accounts, createAccount } = useAccounts();
  const [name, setName] = useState('');
  const [creating, setCreating] = useState(false);

  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    await createAccount(name.trim());
    setName('');
    setCreating(false);
  };

  return (
    <div className="min-h-screen bg-[#0b0f1a] p-8">
      {/* Header */}
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
            <Smartphone size={20} className="text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">Cuentas de WhatsApp</h1>
            <p className="text-sm text-slate-500">Administrá tus números conectados</p>
          </div>
        </div>

        {/* Create Account */}
        <div className="mt-8 bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5">
          <h3 className="text-sm font-bold text-slate-300 mb-3 uppercase tracking-wider">Nueva Cuenta</h3>
          <div className="flex gap-3">
            <input
              className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm placeholder-slate-600 focus:outline-none focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500/50 transition-all"
              placeholder="Nombre de la cuenta (ej: Ventas, Soporte...)"
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            />
            <button
              onClick={handleCreate}
              disabled={creating || !name.trim()}
              className="flex items-center gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white px-6 py-3 rounded-xl font-bold text-sm shadow-lg shadow-emerald-600/20 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50 disabled:hover:translate-y-0"
            >
              <Plus size={16} />
              Agregar
            </button>
          </div>
        </div>

        {/* Account List */}
        <div className="mt-6 space-y-3">
          {accounts.map((a) => {
            const cfg = statusConfig[a.status];
            const StatusIcon = cfg.icon;
            return (
              <div
                key={a.id}
                className="bg-white/5 backdrop-blur-sm border border-white/10 rounded-2xl p-5 hover:bg-white/[0.07] transition-all duration-200 group"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/20 flex items-center justify-center">
                      <Smartphone size={22} className="text-indigo-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white text-base">{a.name}</h3>
                      <p className="text-sm text-slate-500 font-mono">
                        {a.phone_number || 'Sin número asignado'}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border ${cfg.color}`}>
                      <StatusIcon size={12} className={a.status === 'connecting' ? 'animate-spin' : ''} />
                      {cfg.label}
                    </span>
                    <Link
                      to={`/accounts/${a.id}/connect`}
                      className="px-4 py-2 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-400 text-sm font-medium rounded-xl border border-indigo-500/20 transition-all duration-200 hover:-translate-y-0.5"
                    >
                      {a.status === 'connected' ? 'Ver Estado' : 'Conectar'}
                    </Link>
                  </div>
                </div>
              </div>
            );
          })}

          {accounts.length === 0 && (
            <div className="text-center py-16">
              <Smartphone size={48} className="text-slate-700 mx-auto mb-4" />
              <p className="text-slate-500 text-sm">No tenés cuentas. Creá una arriba para empezar.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

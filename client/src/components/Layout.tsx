import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAccounts } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { MessageSquare, Users, Bot, LogOut, Smartphone, ChevronDown } from 'lucide-react';

const navItems = [
  { to: '/accounts', label: 'Cuentas', icon: Users },
  { to: '/inbox', label: 'Inbox', icon: MessageSquare },
  { to: '/builder', label: 'Bot Builder', icon: Bot },
];

export default function Layout() {
  const { accounts, activeAccountId, setActiveAccountId } = useAccounts();
  const { signOut } = useAuth();
  const location = useLocation();

  const activeAccount = accounts.find(a => a.id === activeAccountId);

  return (
    <div className="min-h-screen flex bg-[#0b0f1a]">
      {/* Sidebar */}
      <aside className="w-64 bg-[#111827]/90 backdrop-blur-xl border-r border-white/5 flex flex-col">
        {/* Logo */}
        <div className="p-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
              <Smartphone size={18} className="text-white" />
            </div>
            <div>
              <h1 className="font-bold text-white text-sm tracking-tight">Panel WA</h1>
              <p className="text-[10px] text-slate-500 font-medium">Multi-Cuenta</p>
            </div>
          </div>
        </div>

        {/* Account Selector */}
        <div className="px-4 py-3 border-b border-white/5">
          <label className="block text-[10px] font-bold text-slate-500 uppercase tracking-widest mb-2">Cuenta Activa</label>
          <div className="relative">
            <select
              className="w-full appearance-none bg-white/5 border border-white/10 text-white text-xs rounded-lg px-3 py-2.5 pr-8 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 focus:border-indigo-500/50 transition-all cursor-pointer"
              value={activeAccountId ?? ''}
              onChange={(e) => setActiveAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="bg-[#111827] text-white">
                  {a.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
          </div>
          {activeAccount && (
            <div className="flex items-center gap-2 mt-2 px-1">
              <div className={`w-2 h-2 rounded-full ${
                activeAccount.status === 'connected' ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' :
                activeAccount.status === 'qr' ? 'bg-amber-400 animate-pulse' :
                activeAccount.status === 'connecting' ? 'bg-blue-400 animate-pulse' :
                'bg-slate-600'
              }`} />
              <span className="text-[10px] text-slate-500 capitalize">{activeAccount.status}</span>
              {activeAccount.phone_number && (
                <span className="text-[10px] text-slate-600 ml-auto font-mono">{activeAccount.phone_number}</span>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1">
          {navItems.map(({ to, label, icon: Icon }) => {
            const isActive = location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-200 group ${
                  isActive
                    ? 'bg-indigo-500/10 text-indigo-400 shadow-sm'
                    : 'text-slate-400 hover:text-white hover:bg-white/5'
                }`}
              >
                <Icon size={18} className={`transition-colors ${isActive ? 'text-indigo-400' : 'text-slate-500 group-hover:text-slate-300'}`} />
                {label}
                {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-indigo-400" />}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-white/5">
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-slate-500 hover:text-red-400 text-xs transition-colors w-full px-3 py-2 rounded-lg hover:bg-red-500/5"
          >
            <LogOut size={14} />
            Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}

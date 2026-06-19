import { useState } from 'react';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { useAccounts } from '../context/AccountContext';
import { useAuth } from '../context/AuthContext';
import { MessageSquare, Bot, LogOut, ChevronDown, Phone, Settings, Calendar, ShieldCheck, Users, Menu, X } from 'lucide-react';

const allNav = [
  { to: '/accounts', label: 'Mis Números', icon: Phone, roles: ['admin'] },
  { to: '/inbox', label: 'Mensajes', icon: MessageSquare, roles: ['admin', 'empleada'] },
  { to: '/builder', label: 'Bot Builder', icon: Bot, roles: ['admin'] },
  { to: '/agenda', label: 'Agenda', icon: Calendar, roles: ['admin', 'empleada'] },
  { to: '/team', label: 'Equipo', icon: Users, roles: ['admin'] },
  { to: '/connections', label: 'Conexiones', icon: Settings, roles: ['admin'] },
] as const;

export default function Layout() {
  const { accounts, activeAccountId, setActiveAccountId } = useAccounts();
  const { signOut, role } = useAuth();
  const navItems = allNav.filter(item => role ? (item.roles as readonly string[]).includes(role) : false);
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeAccount = accounts.find(a => a.id === activeAccountId);

  return (
    <div className="min-h-screen flex bg-brand-dark text-brand-textLight font-sans">
      {/* Topbar móvil */}
      <div className="lg:hidden fixed top-0 inset-x-0 z-30 h-14 bg-brand-card/95 backdrop-blur border-b border-white/5 flex items-center justify-between px-4">
        <button onClick={() => setMobileOpen(true)} aria-label="Abrir menú" className="text-brand-textLight p-1">
          <Menu size={22} />
        </button>
        <img src="/logo.png" alt="Prats & Simon" className="h-7 w-auto brightness-0 invert opacity-90" />
        <div className="w-8" />
      </div>

      {/* Backdrop del drawer (móvil) */}
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-40 bg-black/50" onClick={() => setMobileOpen(false)} />
      )}

      {/* Sidebar — drawer en móvil, fija en desktop */}
      <aside className={`w-64 bg-brand-card/90 backdrop-blur-2xl border-r border-white/5 flex flex-col relative overflow-hidden fixed inset-y-0 left-0 z-50 transform transition-transform duration-300 lg:static lg:z-auto lg:translate-x-0 ${mobileOpen ? 'translate-x-0' : '-translate-x-full'}`}>
        {/* Cerrar (solo móvil) */}
        <button onClick={() => setMobileOpen(false)} aria-label="Cerrar menú" className="lg:hidden absolute top-3 right-3 z-20 text-brand-textMuted hover:text-brand-textLight">
          <X size={20} />
        </button>
        {/* Modern glowing background light behind the logo */}
        <div className="absolute -top-20 -left-20 w-40 h-40 bg-brand-secondary/10 rounded-full blur-3xl pointer-events-none" />
        
        {/* Logo Container */}
        <div className="p-5 border-b border-white/5 relative z-10">
          <div className="flex flex-col gap-2 items-center justify-center py-2 px-1 rounded-xl bg-white/[0.02] border border-white/5 shadow-inner group">
            <div className="relative overflow-hidden w-full flex items-center justify-center p-2 rounded-lg">
              {/* Subtle shimmer effect */}
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:animate-shimmer" style={{ backgroundSize: '200% 100%' }} />
              <img 
                src="/logo.png" 
                alt="Prats & Simon Abogados" 
                className="h-10 w-auto object-contain brightness-0 invert opacity-90 transition-all duration-500 group-hover:scale-105 group-hover:opacity-100" 
              />
            </div>
            <div className="flex items-center gap-1.5 mt-1">
              <ShieldCheck size={12} className="text-brand-secondary animate-pulse" />
              <span className="text-[10px] text-brand-secondary font-semibold uppercase tracking-widest">Panel de Control</span>
            </div>
          </div>
        </div>

        {/* Account Selector */}
        <div className="px-4 py-4 border-b border-white/5 relative z-10 bg-brand-dark/30">
          <label className="block text-[9px] font-bold text-brand-secondary/70 uppercase tracking-widest mb-2 px-1">Cuenta Activa</label>
          <div className="relative">
            <select
              className="w-full appearance-none bg-white/5 border border-white/10 text-white text-xs rounded-xl px-3 py-2.5 pr-8 focus:outline-none focus:ring-2 focus:ring-brand-secondary/50 focus:border-brand-secondary/50 transition-all cursor-pointer font-medium"
              value={activeAccountId ?? ''}
              onChange={(e) => setActiveAccountId(e.target.value)}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id} className="bg-[#111827] text-white">
                  {a.name}
                </option>
              ))}
            </select>
            <ChevronDown size={14} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-secondary pointer-events-none" />
          </div>
          {activeAccount && (
            <div className="flex items-center gap-2 mt-2.5 px-1.5 py-1 rounded-lg bg-white/[0.01] border border-white/[0.02]">
              <div className={`w-2 h-2 rounded-full ${
                activeAccount.status === 'connected' ? 'bg-emerald-400 shadow-sm shadow-emerald-400/50' :
                activeAccount.status === 'qr' ? 'bg-amber-400 animate-pulse' :
                activeAccount.status === 'connecting' ? 'bg-blue-400 animate-pulse' :
                'bg-slate-600'
              }`} />
              <span className="text-[10px] text-brand-textMuted capitalize font-medium">{activeAccount.status}</span>
              {activeAccount.phone_number && (
                <span className="text-[10px] text-brand-secondary/70 ml-auto font-mono font-medium">{activeAccount.phone_number}</span>
              )}
            </div>
          )}
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-1 relative z-10">
          {navItems.map(({ to, label, icon: Icon }) => {
            const isActive = location.pathname.startsWith(to);
            return (
              <Link
                key={to}
                to={to}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all duration-300 group relative ${
                  isActive
                    ? 'bg-brand-secondary/10 text-brand-secondary border-l-2 border-brand-accent shadow-sm'
                    : 'text-brand-textMuted hover:text-brand-textLight hover:bg-white/5'
                }`}
              >
                <Icon size={18} className={`transition-colors duration-300 ${isActive ? 'text-brand-secondary' : 'text-slate-500 group-hover:text-brand-secondary/80'}`} />
                {label}
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-brand-accent shadow-sm shadow-brand-accent/50 animate-pulse-glow" />
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-white/5 relative z-10 bg-brand-dark/20">
          <button
            onClick={signOut}
            className="flex items-center gap-2 text-brand-textMuted hover:text-red-400 text-xs transition-all duration-200 w-full px-3 py-2.5 rounded-xl hover:bg-red-500/5 group"
          >
            <LogOut size={14} className="text-slate-500 group-hover:text-red-400 transition-colors" />
            <span>Cerrar sesión</span>
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-gradient-to-b from-brand-dark to-[#090b11] relative pt-14 lg:pt-0 w-full lg:w-auto">
        {/* Ambient background glow decoration in main content */}
        <div className="absolute top-0 right-0 w-96 h-96 bg-brand-secondary/5 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10">
          <Outlet />
        </div>
      </main>
    </div>
  );
}


import { useEffect, useState, useCallback } from 'react';
import { teamApi } from '../lib/api';
import type { Profile } from '../types';
import { toast } from 'sonner';
import { Users, Plus, Loader2, UserCheck, UserX } from 'lucide-react';

export default function Team() {
  const [list, setList] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setList(await teamApi.list()); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!email.trim() || !password.trim()) { toast.error('Email y contraseña requeridos'); return; }
    setCreating(true);
    try {
      await teamApi.create(email.trim(), password.trim(), name.trim());
      toast.success('Empleada creada');
      setEmail(''); setName(''); setPassword('');
      load();
    } catch (e: any) { toast.error('Error: ' + e.message); }
    finally { setCreating(false); }
  };

  const toggleActive = async (p: Profile) => {
    try {
      await teamApi.setActive(p.id, !p.active);
      toast.success(p.active ? 'Acceso revocado' : 'Acceso reactivado');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="min-h-screen bg-[#0b0f1a] p-6 lg:p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8 border-b border-white/5 pb-6">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#304352] to-[#a57b5a] flex items-center justify-center">
            <Users size={22} className="text-[#C6AC98]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white font-serif">Equipo</h1>
            <p className="text-sm text-brand-textMuted">Gestión de empleadas y accesos</p>
          </div>
        </div>

        <div className="glass-card rounded-2xl p-6 mb-8 border border-white/10">
          <h2 className="text-white font-serif font-bold text-lg mb-4">Nueva empleada</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" placeholder="Nombre" value={name} onChange={e => setName(e.target.value)} />
            <input className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" placeholder="Contraseña inicial" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button onClick={create} disabled={creating} className="mt-4 flex items-center gap-2 bg-gradient-to-r from-[#304352] to-[#a57b5a] text-white px-6 py-3 rounded-xl font-bold text-sm disabled:opacity-40">
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Crear
          </button>
        </div>

        <div className="glass-card rounded-2xl border border-white/10 overflow-hidden">
          {loading ? (
            <div className="p-10 flex justify-center"><Loader2 size={24} className="animate-spin text-[#C6AC98]" /></div>
          ) : list.length === 0 ? (
            <p className="p-10 text-center text-brand-textMuted text-sm">Sin empleadas todavía.</p>
          ) : list.map(p => (
            <div key={p.id} className="flex items-center justify-between px-5 py-4 border-b border-white/5 last:border-0">
              <div>
                <div className="text-white text-sm font-semibold">{p.name || '(sin nombre)'}</div>
                <div className="text-brand-textMuted text-xs">{p.email}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[11px] px-2.5 py-1 rounded-full border ${p.active ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                  {p.active ? 'Activa' : 'Inactiva'}
                </span>
                <button onClick={() => toggleActive(p)} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-white/10 text-brand-textMuted hover:text-white">
                  {p.active ? <><UserX size={14} /> Desactivar</> : <><UserCheck size={14} /> Activar</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAccounts } from '../context/AccountContext';
import { appointmentsApi, conversationsApi, type Appointment } from '../lib/api';
import type { WhatsAppConversation } from '../types';
import {
  CalendarDays, CalendarCheck, MessageSquare, Headphones, Radio,
  TrendingUp, Clock, ArrowRight, RefreshCw,
} from 'lucide-react';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

interface StatProps { icon: any; label: string; value: number | string; hint?: string; gold?: boolean }
function StatCard({ icon: Icon, label, value, hint, gold }: StatProps) {
  return (
    <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-4 sm:p-5 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-1 ${gold ? 'bg-brand-gold' : 'bg-brand-primary'}`} />
      <div className="flex items-center justify-between">
        <div className={`w-10 h-10 sm:w-11 sm:h-11 rounded-xl flex items-center justify-center ${gold ? 'bg-brand-gold/20 text-brand-primary' : 'bg-brand-primary/[0.07] text-brand-primary'}`}>
          <Icon size={20} />
        </div>
        {hint && <span className="text-[11px] font-semibold text-brand-inkmuted">{hint}</span>}
      </div>
      <p className="text-2xl sm:text-3xl font-bold text-brand-ink mt-3 font-serif tabular-nums">{value}</p>
      <p className="text-xs sm:text-sm text-brand-inkmuted mt-0.5 leading-tight">{label}</p>
    </div>
  );
}

export default function Dashboard() {
  const { accounts } = useAccounts();
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [convos, setConvos] = useState<WhatsAppConversation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const [apptLists, cv] = await Promise.all([
        Promise.all(accounts.map(a => appointmentsApi.list(a.id).catch(() => [] as Appointment[]))),
        conversationsApi.listAll().catch(() => [] as WhatsAppConversation[]),
      ]);
      setAppts(apptLists.flat());
      setConvos(cv);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (accounts.length) load(); else setLoading(false); /* eslint-disable-next-line */ }, [accounts.length]);

  const now = new Date();
  const stats = useMemo(() => {
    const startWeek = new Date(now); startWeek.setDate(now.getDate() - now.getDay()); startWeek.setHours(0, 0, 0, 0);
    const endWeek = new Date(startWeek); endWeek.setDate(startWeek.getDate() + 7);
    const withTime = appts.filter(a => a.start_time);
    const hoy = withTime.filter(a => sameDay(new Date(a.start_time!), now));
    const semana = withTime.filter(a => { const d = new Date(a.start_time!); return d >= startWeek && d < endWeek; });
    const conectadas = accounts.filter(a => a.status === 'connected').length;
    const enAtencion = convos.filter(c => c.status === 'HANDOVER').length;

    // Conteo por estado (citas de la semana)
    const porEstado: Record<string, number> = {};
    for (const a of withTime) porEstado[a.status] = (porEstado[a.status] || 0) + 1;

    // Últimos 7 días: citas por día
    const dias: { label: string; count: number; isToday: boolean }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      dias.push({
        label: DIAS[d.getDay()],
        count: withTime.filter(a => sameDay(new Date(a.start_time!), d)).length,
        isToday: i === 0,
      });
    }

    // Próximas citas
    const proximas = withTime
      .filter(a => new Date(a.start_time!) >= now && a.status !== 'cancelada')
      .sort((a, b) => new Date(a.start_time!).getTime() - new Date(b.start_time!).getTime())
      .slice(0, 5);

    return { hoy, semana, conectadas, enAtencion, porEstado, dias, proximas };
  }, [appts, convos, accounts]);

  const maxBar = Math.max(1, ...stats.dias.map(d => d.count));
  const estadoLabels: Record<string, string> = {
    pendiente: 'Pendientes', confirmada: 'Confirmadas', asistio: 'Asistieron',
    no_asistio: 'No asistieron', cancelada: 'Canceladas', cerrado: 'Cerradas',
  };

  return (
    <div className="min-h-full p-4 sm:p-6 lg:p-8">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 mb-6 sm:mb-7">
          <div className="min-w-0">
            <h1 className="text-xl sm:text-2xl lg:text-3xl font-bold text-brand-ink font-serif">Panel del estudio</h1>
            <p className="text-xs sm:text-sm text-brand-inkmuted mt-1 capitalize">
              {now.toLocaleDateString('es-AR', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
          </div>
          <button onClick={() => { setLoading(true); load(); }}
            className="flex-shrink-0 flex items-center gap-2 text-xs font-semibold text-brand-inkmuted hover:text-brand-primary px-3 py-2 rounded-lg hover:bg-brand-panel transition-colors">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> <span className="hidden sm:inline">Actualizar</span>
          </button>
        </div>

        {/* Stat cards */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-5 sm:mb-6">
          <StatCard icon={CalendarDays} label="Citas hoy" value={stats.hoy.length} hint="agenda" gold />
          <StatCard icon={CalendarCheck} label="Citas esta semana" value={stats.semana.length} />
          <StatCard icon={MessageSquare} label="Conversaciones" value={convos.length} />
          <StatCard icon={Headphones} label="En atención humana" value={stats.enAtencion} hint="handover" />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 sm:gap-6">
          {/* Bar chart — últimos 7 días */}
          <div className="lg:col-span-2 bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-5 sm:p-6">
            <div className="flex items-center gap-2 mb-5">
              <TrendingUp size={18} className="text-brand-primary" />
              <h3 className="font-serif font-bold text-brand-ink">Citas — últimos 7 días</h3>
            </div>
            <div className="flex items-end justify-between gap-1.5 sm:gap-3 h-40 sm:h-44">
              {stats.dias.map((d, i) => (
                <div key={i} className="flex-1 flex flex-col items-center justify-end h-full gap-2">
                  <span className="text-xs font-bold text-brand-ink tabular-nums">{d.count}</span>
                  <div
                    className={`w-full rounded-t-md transition-all ${d.isToday ? 'bg-brand-gold' : 'bg-brand-primary'}`}
                    style={{ height: `${Math.max(6, (d.count / maxBar) * 100)}%` }}
                    title={`${d.count} citas`}
                  />
                  <span className={`text-[11px] ${d.isToday ? 'text-brand-ink font-bold' : 'text-brand-inkmuted'}`}>{d.label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Estado de citas */}
          <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-5 sm:p-6">
            <h3 className="font-serif font-bold text-brand-ink mb-5">Estado de las citas</h3>
            <div className="space-y-3">
              {(['pendiente', 'confirmada', 'asistio', 'no_asistio'] as const).map(st => {
                const total = appts.filter(a => a.start_time).length || 1;
                const n = stats.porEstado[st] || 0;
                const pct = Math.round((n / total) * 100);
                return (
                  <div key={st}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-brand-inkmuted">{estadoLabels[st]}</span>
                      <span className="font-bold text-brand-ink tabular-nums">{n}</span>
                    </div>
                    <div className="h-2 rounded-full bg-brand-panel overflow-hidden">
                      <div className={`h-full rounded-full ${st === 'confirmada' || st === 'asistio' ? 'bg-brand-primary' : st === 'no_asistio' ? 'bg-red-400' : 'bg-brand-gold'}`}
                        style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
            <div className="mt-5 pt-4 border-t border-brand-hairline flex items-center gap-2 text-xs text-brand-inkmuted">
              <Radio size={13} className="text-emerald-600" /> {stats.conectadas} de {accounts.length} líneas conectadas
            </div>
          </div>
        </div>

        {/* Próximas citas */}
        <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-5 sm:p-6 mt-4 sm:mt-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-serif font-bold text-brand-ink">Próximas citas</h3>
            <Link to="/agenda" className="flex items-center gap-1 text-xs font-semibold text-brand-primary hover:text-brand-accent">
              Ver agenda <ArrowRight size={13} />
            </Link>
          </div>
          {loading ? (
            <p className="text-sm text-brand-inkmuted py-6 text-center">Cargando…</p>
          ) : stats.proximas.length === 0 ? (
            <p className="text-sm text-brand-inkmuted py-6 text-center">No hay citas próximas agendadas.</p>
          ) : (
            <div className="divide-y divide-brand-hairline">
              {stats.proximas.map(a => {
                const d = new Date(a.start_time!);
                return (
                  <div key={a.id} className="flex items-center gap-3 py-3">
                    <div className="w-10 h-10 rounded-xl bg-brand-primary/[0.07] text-brand-primary flex flex-col items-center justify-center leading-none">
                      <span className="text-[9px] uppercase">{DIAS[d.getDay()]}</span>
                      <span className="text-sm font-bold tabular-nums">{d.getDate()}</span>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-brand-ink truncate">{a.nombre || 'Sin nombre'}</p>
                      <p className="text-xs text-brand-inkmuted truncate">{a.resumen || a.oficina || 'Cita'}</p>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs font-semibold text-brand-inkmuted whitespace-nowrap">
                      <Clock size={12} className="text-brand-inkmuted" />
                      {d.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

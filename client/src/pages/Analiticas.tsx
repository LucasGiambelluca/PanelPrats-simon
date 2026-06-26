import { useEffect, useState } from 'react';
import { useAccounts } from '../context/AccountContext';
import {
  analyticsApi, type IntakeAnalytics,
  MOTIVO_LABELS, CANAL_LABELS, RESULTADO_LABELS,
} from '../lib/api';
import { BarChart3, Users, Target, RefreshCw } from 'lucide-react';

const pct = (n: number) => `${Math.round(n * 100)}%`;

// Colores de la disposición del lead (como la planilla: verde/rojo/amarillo/celeste).
const RESULTADO_COLOR: Record<string, string> = {
  si: 'bg-emerald-500', no: 'bg-red-500', pensar: 'bg-amber-400', traer_doc: 'bg-sky-400',
  sin_dato: 'bg-brand-hairline',
};

function StatCard({ icon: Icon, label, value, gold }: { icon: any; label: string; value: string | number; gold?: boolean }) {
  return (
    <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-5 relative overflow-hidden">
      <div className={`absolute top-0 left-0 right-0 h-1 ${gold ? 'bg-brand-gold' : 'bg-brand-primary'}`} />
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${gold ? 'bg-brand-gold/20 text-brand-primary' : 'bg-brand-primary/[0.07] text-brand-primary'}`}>
        <Icon size={20} />
      </div>
      <p className="text-3xl font-bold text-brand-ink mt-3 font-serif tabular-nums">{value}</p>
      <p className="text-sm text-brand-inkmuted mt-0.5">{label}</p>
    </div>
  );
}

// Barras horizontales a partir de un Record<clave, cantidad>.
function BarList({ data, labels, colors }: {
  data: Record<string, number>; labels?: Record<string, string>; colors?: Record<string, string>;
}) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(1, ...entries.map(([, v]) => v));
  if (!entries.length) return <p className="text-xs text-brand-inkmuted">Sin datos.</p>;
  return (
    <div className="space-y-2">
      {entries.map(([k, v]) => (
        <div key={k} className="flex items-center gap-2">
          <span className="w-32 shrink-0 text-xs text-brand-ink truncate">{labels?.[k] ?? k}</span>
          <div className="flex-1 h-5 bg-brand-ivory rounded-md overflow-hidden">
            <div className={`h-full rounded-md ${colors?.[k] ?? 'bg-brand-primary'}`} style={{ width: `${(v / max) * 100}%` }} />
          </div>
          <span className="w-10 text-right text-xs font-semibold text-brand-ink tabular-nums">{v}</span>
        </div>
      ))}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-5">
      <h3 className="text-sm font-bold text-brand-ink mb-4">{title}</h3>
      {children}
    </div>
  );
}

export default function Analiticas() {
  const { accounts } = useAccounts();
  const [accountId, setAccountId] = useState('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [data, setData] = useState<IntakeAnalytics | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      const d = await analyticsApi.intake({
        account_id: accountId,
        from: from ? new Date(from).toISOString() : undefined,
        to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
      });
      setData(d);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [accountId, from, to]);

  return (
    <div className="p-4 sm:p-6 max-w-6xl mx-auto space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-serif font-bold text-brand-ink flex items-center gap-2">
            <BarChart3 size={24} className="text-brand-primary" /> Analíticas de recepción
          </h1>
          <p className="text-sm text-brand-inkmuted">Conversión de leads, canales y motivos.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <select value={accountId} onChange={(e) => setAccountId(e.target.value)}
            className="border border-brand-hairline rounded-xl px-3 py-2 text-xs bg-brand-surface text-brand-ink">
            <option value="all">Todas las líneas</option>
            {accounts.map(a => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
          <label className="text-xs text-brand-inkmuted flex flex-col gap-0.5">Desde
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)}
              className="border border-brand-hairline rounded-xl px-2 py-1.5 text-xs bg-brand-surface text-brand-ink" />
          </label>
          <label className="text-xs text-brand-inkmuted flex flex-col gap-0.5">Hasta
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)}
              className="border border-brand-hairline rounded-xl px-2 py-1.5 text-xs bg-brand-surface text-brand-ink" />
          </label>
          <button onClick={load} className="p-2 rounded-xl border border-brand-hairline bg-brand-surface text-brand-primary hover:bg-brand-ivory">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {!data ? (
        <p className="text-sm text-brand-inkmuted">{loading ? 'Cargando…' : 'Sin datos.'}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <StatCard icon={Users} label="Reuniones / leads" value={data.total} />
            <StatCard icon={Target} label="Conversión (cliente)" value={pct(data.conversion)} gold />
            <StatCard icon={Users} label="Cerrados como cliente" value={data.porResultado?.si ?? 0} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Resultado (disposición del lead)">
              <BarList data={data.porResultado} labels={RESULTADO_LABELS} colors={RESULTADO_COLOR} />
            </Card>
            <Card title="Cómo nos conoció (canal)">
              <BarList data={data.porCanal} labels={CANAL_LABELS} />
            </Card>
            <Card title="Motivo de consulta">
              <BarList data={data.porMotivo} labels={MOTIVO_LABELS} />
            </Card>
            <Card title="Por mes">
              {data.porMes.length === 0 ? (
                <p className="text-xs text-brand-inkmuted">Sin datos.</p>
              ) : (
                <table className="w-full text-xs">
                  <thead><tr className="text-brand-inkmuted text-left">
                    <th className="pb-2">Mes</th><th className="pb-2 text-right">Reuniones</th><th className="pb-2 text-right">Conversión</th>
                  </tr></thead>
                  <tbody>
                    {data.porMes.map(m => (
                      <tr key={m.bucket} className="border-t border-brand-hairline">
                        <td className="py-1.5 text-brand-ink">{m.bucket}</td>
                        <td className="py-1.5 text-right tabular-nums">{m.total}</td>
                        <td className="py-1.5 text-right tabular-nums font-semibold">{pct(m.conversion)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Card>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <RankTable title="Por empleada (recepción)" rows={data.porEmpleada} />
            <RankTable title="Por abogada (profesional)" rows={data.porAbogada} />
          </div>
        </>
      )}
    </div>
  );
}

function RankTable({ title, rows }: { title: string; rows: { id: string; name: string; total: number; conversion: number }[] }) {
  return (
    <Card title={title}>
      {rows.length === 0 ? (
        <p className="text-xs text-brand-inkmuted">Sin datos.</p>
      ) : (
        <table className="w-full text-xs">
          <thead><tr className="text-brand-inkmuted text-left">
            <th className="pb-2">Nombre</th><th className="pb-2 text-right">Reuniones</th><th className="pb-2 text-right">Conversión</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t border-brand-hairline">
                <td className="py-1.5 text-brand-ink">{r.name}</td>
                <td className="py-1.5 text-right tabular-nums">{r.total}</td>
                <td className="py-1.5 text-right tabular-nums font-semibold">{pct(r.conversion)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );
}

import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { pendientesApi, type FilaPendiente } from '../lib/api';

const AREA_LABELS: Record<string, string> = {
  jubilacion: 'Jubilación', jubilacion_hombre: 'Jubilación (H)', jubilacion_mujer: 'Jubilación (M)',
  pension: 'Pensión', laboral: 'Laboral', art: 'ART', accidente: 'Accidente',
};
const CANAL_LABELS: Record<string, string> = { whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram' };
const CALIF_LABELS: Record<string, string> = { gratis: 'Gratis', pago: 'Pago', a_confirmar: 'A confirmar' };

const RANGES = [
  { value: 'all', label: 'Todo' }, { value: '90d', label: '90 días' },
  { value: '30d', label: '30 días' }, { value: '7d', label: '7 días' },
];

function fmtFecha(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function toCSV(filas: FilaPendiente[]): string {
  const head = ['Telefono', 'Nombre', 'Canal', 'Area', 'Calificacion', 'Estado', 'Ultimo tema', 'Ultimo mensaje', 'Fecha', 'Llamado'];
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  const rows = filas.map((f) => [
    // Teléfono como texto (prefijo tab) para que Excel no coma el 0/15 ni lo pase a notación científica.
    `\t${f.telefono}`,
    f.nombre ?? '', CANAL_LABELS[f.canal] ?? f.canal, f.area ? (AREA_LABELS[f.area] ?? f.area) : '',
    f.calificacion ? (CALIF_LABELS[f.calificacion] ?? f.calificacion) : '',
    f.estado, f.tema ?? '', (f.ultimo_mensaje ?? '').replace(/\s+/g, ' ').slice(0, 200), fmtFecha(f.fecha),
    f.llamado ? `sí (${fmtFecha(f.llamado_at)})` : 'no',
  ].map((c) => esc(String(c))).join(','));
  return [head.map(esc).join(','), ...rows].join('\r\n');
}

function descargarCSV(filas: FilaPendiente[]) {
  const blob = new Blob(['﻿' + toCSV(filas)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `pendientes-llamar-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export default function PendientesLlamar() {
  const [filas, setFilas] = useState<FilaPendiente[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState('all');
  const [canal, setCanal] = useState('all');
  const [calif, setCalif] = useState('all');
  const [ocultarLlamados, setOcultarLlamados] = useState(false);

  const toggleLlamado = async (f: FilaPendiente) => {
    const nuevo = !f.llamado;
    // Optimista: actualizo la fila en memoria; si falla, revierto.
    setFilas((prev) => prev.map((x) => x.conversation_id === f.conversation_id
      ? { ...x, llamado: nuevo, llamado_at: nuevo ? new Date().toISOString() : null } : x));
    try {
      await pendientesApi.marcar({ accountId: f.account_id, telefono: f.telefono, llamado: nuevo });
    } catch {
      setFilas((prev) => prev.map((x) => x.conversation_id === f.conversation_id ? { ...x, llamado: f.llamado, llamado_at: f.llamado_at } : x));
    }
  };

  useEffect(() => {
    setLoading(true); setError(null);
    pendientesApi.list({ range })
      .then((r) => setFilas(r.filas))
      .catch((e) => setError(e?.message ?? 'Error'))
      .finally(() => setLoading(false));
  }, [range]);

  // Canales realmente presentes en los datos: hoy es todo WhatsApp, así que el filtro de
  // canal solo se muestra si hay más de uno (antes ofrecía FB/IG y daba lista vacía).
  const canalesPresentes = useMemo(() => Array.from(new Set(filas.map((f) => f.canal))), [filas]);

  const visibles = useMemo(() => filas.filter((f) =>
    (canal === 'all' || f.canal === canal) &&
    (calif === 'all' || f.calificacion === calif) &&
    (!ocultarLlamados || !f.llamado)
  ), [filas, canal, calif, ocultarLlamados]);

  return (
    <div className="p-4 sm:p-6 max-w-full">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h1 className="text-xl font-bold text-brand-ink">Pendientes de llamar</h1>
          <p className="text-sm text-brand-inkmuted">Contactos sin reunión coordinada, con teléfono. {visibles.length} para llamar.</p>
        </div>
        <button
          onClick={() => descargarCSV(visibles)}
          disabled={!visibles.length}
          className="px-4 py-2 rounded-lg bg-brand-gold text-brand-ink font-semibold text-sm disabled:opacity-40 hover:opacity-90"
        >Exportar CSV</button>
      </div>

      <div className="flex flex-wrap gap-2 mb-4 text-sm">
        <select value={range} onChange={(e) => setRange(e.target.value)} className="border rounded-lg px-2 py-1 bg-white">
          {RANGES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
        </select>
        {canalesPresentes.length > 1 && (
          <select value={canal} onChange={(e) => setCanal(e.target.value)} className="border rounded-lg px-2 py-1 bg-white">
            <option value="all">Todos los canales</option>
            {canalesPresentes.map((c) => <option key={c} value={c}>{CANAL_LABELS[c] ?? c}</option>)}
          </select>
        )}
        <select value={calif} onChange={(e) => setCalif(e.target.value)} className="border rounded-lg px-2 py-1 bg-white">
          <option value="all">Toda calificación</option>
          <option value="gratis">Gratis</option><option value="pago">Pago</option><option value="a_confirmar">A confirmar</option>
        </select>
        <label className="flex items-center gap-2 px-2 py-1 select-none">
          <input type="checkbox" checked={ocultarLlamados} onChange={(e) => setOcultarLlamados(e.target.checked)} />
          Ocultar llamados
        </label>
      </div>

      {loading && <p className="text-brand-inkmuted text-sm">Cargando…</p>}
      {error && <p className="text-red-600 text-sm">Error: {error}</p>}
      {!loading && !error && (
        <div className="overflow-x-auto border rounded-lg">
          <table className="min-w-full text-sm">
            <thead className="bg-brand-panel text-brand-inkmuted">
              <tr>
                {['Teléfono', 'Nombre', 'Canal', 'Área', 'Calificación', 'Estado', 'Tema', 'Fecha', 'Acciones'].map((h) => (
                  <th key={h} className="text-left font-semibold px-3 py-2 whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibles.map((f) => (
                <tr key={f.conversation_id} className={`border-t hover:bg-brand-panel/50 ${f.llamado ? 'opacity-50' : ''}`}>
                  <td className="px-3 py-2 whitespace-nowrap font-mono">
                    <a className="text-brand-primary hover:underline" href={`whatsapp://send?phone=${f.telefono.startsWith('54') ? f.telefono.replace(/^54/, '549') : f.telefono}`} title="Abrir en WhatsApp Desktop">{f.telefono}</a>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">{f.nombre ?? <span className="text-brand-inkmuted italic">Sin nombre</span>}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{CANAL_LABELS[f.canal] ?? f.canal}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{f.area ? (AREA_LABELS[f.area] ?? f.area) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{f.calificacion ? (CALIF_LABELS[f.calificacion] ?? f.calificacion) : '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{f.estado}</td>
                  <td className="px-3 py-2 max-w-[200px] truncate" title={f.tema ?? ''}>{f.tema ?? '—'}</td>
                  <td className="px-3 py-2 whitespace-nowrap">{fmtFecha(f.fecha)}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Link to={`/inbox?conv=${f.conversation_id}`} className="text-brand-primary hover:underline">Ir al chat</Link>
                      <button
                        onClick={() => toggleLlamado(f)}
                        title={f.llamado && f.llamado_por ? `Llamado por ${f.llamado_por}` : ''}
                        className={`px-2 py-0.5 rounded text-xs font-semibold ${f.llamado ? 'bg-green-100 text-green-800' : 'bg-brand-gold text-brand-ink'}`}
                      >{f.llamado ? '✓ Llamado' : '☎ Marcar llamado'}</button>
                    </div>
                  </td>
                </tr>
              ))}
              {!visibles.length && (
                <tr><td colSpan={9} className="px-3 py-6 text-center text-brand-inkmuted">Nadie pendiente con estos filtros.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

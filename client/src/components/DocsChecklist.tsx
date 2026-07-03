import { useEffect, useState } from 'react';
import { docsApi, type AppointmentDoc } from '../lib/api';

export function DocsChecklist({ appointmentId, accountId }: { appointmentId: string; accountId: string }) {
  const [docs, setDocs] = useState<AppointmentDoc[]>([]);
  const [nuevo, setNuevo] = useState('');
  const [loading, setLoading] = useState(true);

  const recargar = () => docsApi.list(appointmentId).then((r) => setDocs(r.docs)).finally(() => setLoading(false));
  useEffect(() => { recargar(); /* eslint-disable-next-line */ }, [appointmentId]);

  const pendientes = docs.filter((d) => d.estado === 'pendiente').length;

  const agregar = async () => {
    const doc = nuevo.trim();
    if (!doc) return;
    setNuevo('');
    await docsApi.add(appointmentId, accountId, doc).catch(() => {});
    recargar();
  };
  const toggle = async (d: AppointmentDoc) => {
    await docsApi.setEstado(d.id, d.estado === 'pendiente' ? 'entregado' : 'pendiente').catch(() => {});
    recargar();
  };
  const borrar = async (d: AppointmentDoc) => {
    await docsApi.remove(d.id).catch(() => {});
    recargar();
  };

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="font-semibold text-sm text-brand-ink">Documentación</h4>
        {pendientes > 0 && <span className="text-xs bg-amber-100 text-amber-800 rounded px-2 py-0.5">{pendientes} pendiente{pendientes > 1 ? 's' : ''}</span>}
      </div>
      {loading ? <p className="text-xs text-brand-inkmuted">Cargando…</p> : (
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={d.estado === 'entregado'} onChange={() => toggle(d)} />
              <span className={d.estado === 'entregado' ? 'line-through text-brand-inkmuted' : ''}>{d.documento}</span>
              <button onClick={() => borrar(d)} className="ml-auto text-xs text-red-500 hover:underline">quitar</button>
            </li>
          ))}
          {!docs.length && <li className="text-xs text-brand-inkmuted">Sin documentos cargados.</li>}
        </ul>
      )}
      <div className="flex gap-2 mt-2">
        <input
          value={nuevo} onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }}
          placeholder="Agregar documento (ej: DNI)"
          className="border rounded px-2 py-1 text-sm flex-1"
        />
        <button onClick={agregar} className="px-3 py-1 rounded bg-brand-gold text-brand-ink text-sm font-semibold">Agregar</button>
      </div>
    </div>
  );
}

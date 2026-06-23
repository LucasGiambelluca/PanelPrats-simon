import type { Office } from '../../types';

export default function OfficeDetail({ office, onClose }: { office: Office; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-brand-surface h-full p-6 overflow-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-serif font-bold text-brand-ink">{office.nombre}</h2>
        <button onClick={onClose} className="mt-4 text-sm text-brand-inkmuted">Cerrar</button>
      </div>
    </div>
  );
}

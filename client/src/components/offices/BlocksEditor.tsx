import type { Office, OfficeProfessional } from '../../types';
export default function BlocksEditor({ prof, onClose }: { office: Office; prof: OfficeProfessional; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-brand-surface rounded-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <p className="text-brand-ink">Bloqueos de {prof.name}</p>
        <button onClick={onClose} className="mt-4 text-sm text-brand-inkmuted">Cerrar</button>
      </div>
    </div>
  );
}

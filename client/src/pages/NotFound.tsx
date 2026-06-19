import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-brand-ivory p-6 text-center">
      <div className="max-w-md">
        <img src="/logo.png" alt="Prats & Simon" className="h-14 mx-auto mb-6 brightness-0 opacity-75" />
        <p className="text-6xl font-serif font-bold text-brand-secondary mb-2">404</p>
        <h1 className="text-2xl font-serif font-bold text-brand-ink mb-2">Página no encontrada</h1>
        <p className="text-brand-inkmuted mb-6">La dirección que abriste no existe o cambió.</p>
        <Link
          to="/"
          className="inline-block px-6 py-2.5 rounded-xl bg-brand-secondary hover:bg-brand-accent text-brand-dark font-bold transition-colors">
          Volver al inicio
        </Link>
      </div>
    </div>
  );
}

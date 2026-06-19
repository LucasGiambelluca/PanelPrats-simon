import { Component, type ReactNode } from 'react';

interface Props { children: ReactNode }
interface State { hasError: boolean; message: string }

/** Atrapa errores de render para que un throw en una página no deje la app en blanco. */
export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: any): State {
    return { hasError: true, message: String(err?.message || err || '') };
  }

  componentDidCatch(err: any, info: any) {
    console.error('[ErrorBoundary]', err, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen w-full flex items-center justify-center bg-brand-ivory p-6 text-center">
        <div className="max-w-md">
          <img src="/logo.png" alt="Prats & Simon" className="h-14 mx-auto mb-6 brightness-0 opacity-75" />
          <h1 className="text-2xl font-serif font-bold text-brand-ink mb-2">Algo salió mal</h1>
          <p className="text-brand-inkmuted mb-6">
            Ocurrió un problema en el panel. Probá recargar; si sigue, avisá al administrador.
          </p>
          {import.meta.env.DEV && this.state.message && (
            <p className="text-amber-400/70 text-xs mb-6 font-mono break-words">{this.state.message}</p>
          )}
          <button
            onClick={() => window.location.reload()}
            className="px-6 py-2.5 rounded-xl bg-brand-secondary hover:bg-brand-accent text-brand-dark font-bold transition-colors">
            Recargar
          </button>
        </div>
      </div>
    );
  }
}

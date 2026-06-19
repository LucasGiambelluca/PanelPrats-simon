import { useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Lock, Mail, AlertCircle, Shield } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { signIn } = useAuth();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const { error } = await signIn(email, password);
      if (error) throw error;
      navigate('/');
    } catch (err) {
      setError('Credenciales inválidas. Verificá tu email y contraseña.');
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-brand-ivory flex items-center justify-center p-4 overflow-hidden relative font-sans">
      {/* Decorative background gradients */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-brand-secondary/10 rounded-full blur-[120px] -z-10 pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-brand-accent/10 rounded-full blur-[120px] -z-10 pointer-events-none" />

      {/* LOGIN CARD */}
      <div className="max-w-md w-full bg-brand-surface backdrop-blur-xl border border-brand-hairline p-8 md:p-10 rounded-[2.5rem] shadow-2xl text-center animate-fade-in relative overflow-hidden">
        {/* Subtle decorative top border in brand color */}
        <div className="absolute top-0 left-0 right-0 h-1.5 bg-gradient-to-r from-brand-secondary to-brand-accent" />
        
        {/* Logo Container */}
        <div className="flex justify-center mb-8 p-5 bg-brand-panel border border-brand-hairline rounded-2xl relative overflow-hidden group">
          <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent -translate-x-full group-hover:animate-shimmer" style={{ backgroundSize: '200% 100%' }} />
          <img
            src="/logo.png"
            alt="Prats & Simon Abogados"
            className="h-12 w-auto object-contain brightness-0 opacity-80 transition-all duration-500 group-hover:scale-105 group-hover:opacity-100"
          />
        </div>

        <div className="flex items-center justify-center gap-1.5 mb-6 text-brand-secondary">
          <Shield size={14} className="animate-pulse" />
          <span className="text-[10px] font-bold uppercase tracking-widest">Acceso Privado</span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 text-left">
          {error && (
            <div className="bg-red-500/10 border border-red-500/20 text-red-400 p-4 rounded-2xl text-sm flex items-start space-x-2">
              <AlertCircle size={18} className="mt-0.5 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          <div className="space-y-5">
            <div>
              <label className="block text-xs font-bold text-brand-secondary/80 uppercase tracking-wider mb-2 px-1">Correo electrónico</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-brand-inkmuted/60" />
                </div>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="block w-full bg-white border border-brand-hairline pl-11 pr-4 py-3.5 rounded-2xl text-brand-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 focus:border-transparent transition-all text-sm font-medium"
                  placeholder="nombre@estudio.com"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-brand-secondary/80 uppercase tracking-wider mb-2 px-1">Contraseña</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-brand-inkmuted/60" />
                </div>
                <input
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="block w-full bg-white border border-brand-hairline pl-11 pr-4 py-3.5 rounded-2xl text-brand-ink placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 focus:border-transparent transition-all text-sm font-medium"
                  placeholder="••••••••"
                />
              </div>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full relative group overflow-hidden bg-gradient-to-r from-brand-secondary to-brand-accent hover:from-brand-secondary/95 hover:to-brand-accent/95 text-white py-4 rounded-2xl font-extrabold shadow-lg shadow-brand-secondary/10 transition-all duration-300 transform hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50 text-sm tracking-wide"
          >
            <span className="relative z-10 flex items-center justify-center">
              {loading ? (
                <div className="flex items-center space-x-2">
                  <div className="w-2 h-2 bg-white rounded-full animate-bounce [animation-delay:-0.3s]" />
                  <div className="w-2 h-2 bg-white rounded-full animate-bounce [animation-delay:-0.15s]" />
                  <div className="w-2 h-2 bg-white rounded-full animate-bounce" />
                </div>
              ) : 'Entrar al Panel'}
            </span>
          </button>

          <p className="text-center text-[11px] text-brand-inkmuted/70 pt-1">
            ¿Olvidaste tu contraseña? Pedile al administrador del estudio que te la reinicie.
          </p>
        </form>
      </div>
    </div>
  );
}


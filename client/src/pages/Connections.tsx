import { useState, useEffect } from 'react';
import { configApi } from '../lib/api';
import { toast } from 'sonner';
import {
  Settings, Save, Database, RefreshCw, Key, Link2, Server, HelpCircle, ShieldAlert
} from 'lucide-react';

export default function Connections() {
  const [configs, setConfigs] = useState<Record<string, string>>({
    SUPABASE_URL: '',
    SUPABASE_SERVICE_KEY: '',
    DATABASE_URL: '',
    REDIS_URL: 'redis://127.0.0.1:6379',
    AUTH_BASE_PATH: './auth',
    GROQ_API_KEY: '',
    GEMINI_API_KEY: '',
    PORT: '3001',
    CORS_ORIGIN: 'http://localhost:5173',
  });

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [restarting, setRestarting] = useState(false);

  // Load current configurations from backend
  useEffect(() => {
    async function load() {
      try {
        const data = await configApi.get();
        setConfigs(prev => ({ ...prev, ...data }));
      } catch (err: any) {
        toast.error('Error al cargar configuraciones: ' + err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  const handleChange = (key: string, value: string) => {
    setConfigs(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await configApi.save(configs);
      toast.success('Configuraciones guardadas localmente en el archivo .env');
    } catch (err: any) {
      toast.error('Error al guardar: ' + err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleSyncDb = async () => {
    if (!configs.DATABASE_URL) {
      toast.error('Debes ingresar la URL de conexión de PostgreSQL (DATABASE_URL) primero.');
      return;
    }
    setSyncing(true);
    try {
      const res = await configApi.syncDb(configs.DATABASE_URL);
      toast.success(res.message || 'Tablas de base de datos sincronizadas con éxito.');
    } catch (err: any) {
      toast.error('Error de sincronización: ' + err.message);
    } finally {
      setSyncing(false);
    }
  };

  const doRestart = async () => {
    setRestarting(true);
    try {
      const res = await configApi.restart();
      toast.info(res.message || 'Reiniciando el backend...');
      setTimeout(() => { window.location.reload(); }, 3000);
    } catch (err: any) {
      toast.error('Error al intentar reiniciar: ' + err.message);
      setRestarting(false);
    }
  };

  const handleRestart = () => {
    toast('¿Reiniciar la aplicación? Aplica los cambios del .env y desconecta el panel un instante.', {
      duration: 10000,
      action: { label: 'Reiniciar', onClick: () => doRestart() },
      cancel: { label: 'Cancelar', onClick: () => {} },
    });
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-brand-ivory">
        <div className="text-center">
          <RefreshCw className="animate-spin text-brand-secondary mx-auto mb-4" size={36} />
          <p className="text-brand-inkmuted text-sm">Cargando configuraciones...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand-ivory p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-brand-primary/[0.07] text-brand-primary flex items-center justify-center">
              <Settings size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-brand-ink font-serif">Conexiones</h1>
              <p className="text-sm text-brand-inkmuted">Configurá las credenciales, bases de datos y servicios externos</p>
            </div>
          </div>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/15 text-red-600 text-xs font-semibold rounded-xl border border-red-500/20 transition-all duration-200 disabled:opacity-50"
          >
            <RefreshCw size={14} className={restarting ? 'animate-spin' : ''} />
            {restarting ? 'Reiniciando…' : 'Reiniciar Servidor'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Config Form */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Supabase & DB section */}
            <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-brand-primary" />
              <h2 className="font-serif font-bold text-brand-ink text-base mb-5 flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-brand-primary/[0.07] text-brand-primary flex items-center justify-center">
                  <Database size={16} />
                </span>
                Base de Datos y Supabase
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-brand-inkmuted uppercase tracking-wider mb-2">SUPABASE URL</label>
                  <input
                    type="text"
                    value={configs.SUPABASE_URL}
                    onChange={(e) => handleChange('SUPABASE_URL', e.target.value)}
                    placeholder="https://tu-proyecto.supabase.co"
                    className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-brand-inkmuted uppercase tracking-wider mb-2">SUPABASE SERVICE ROLE KEY</label>
                  <div className="relative">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-inkmuted" size={16} />
                    <input
                      type="password"
                      value={configs.SUPABASE_SERVICE_KEY}
                      onChange={(e) => handleChange('SUPABASE_SERVICE_KEY', e.target.value)}
                      placeholder="eyJhbGciOi..."
                      className="w-full bg-white border border-brand-hairline rounded-xl pl-11 pr-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 transition-all font-mono"
                    />
                  </div>
                  <p className="text-[10px] text-brand-inkmuted mt-1.5">
                    Debe ser la clave "service_role" para omitir las políticas de RLS al guardar datos del sistema.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-brand-inkmuted uppercase tracking-wider mb-2">PostgreSQL DATABASE URL</label>
                  <div className="relative">
                    <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 text-brand-inkmuted" size={16} />
                    <input
                      type="text"
                      value={configs.DATABASE_URL}
                      onChange={(e) => handleChange('DATABASE_URL', e.target.value)}
                      placeholder="postgresql://postgres:password@db.supabase.co:5432/postgres"
                      className="w-full bg-white border border-brand-hairline rounded-xl pl-11 pr-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 transition-all font-mono"
                    />
                  </div>
                  <p className="text-[10px] text-brand-inkmuted mt-1.5">
                    Requerida para realizar la sincronización inicial de tablas.
                  </p>
                </div>
              </div>
            </div>

            {/* APIs & Services */}
            <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-6">
              <h2 className="font-serif font-bold text-brand-ink text-base mb-5 flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-brand-primary/[0.07] text-brand-primary flex items-center justify-center">
                  <Server size={16} />
                </span>
                Servicios Externos e Infraestructura
              </h2>
              
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-brand-inkmuted uppercase tracking-wider mb-2">REDIS URL</label>
                    <input
                      type="text"
                      value={configs.REDIS_URL}
                      onChange={(e) => handleChange('REDIS_URL', e.target.value)}
                      placeholder="redis://127.0.0.1:6379"
                      className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-brand-inkmuted uppercase tracking-wider mb-2">Carpeta Auth Baileys</label>
                    <input
                      type="text"
                      value={configs.AUTH_BASE_PATH}
                      onChange={(e) => handleChange('AUTH_BASE_PATH', e.target.value)}
                      placeholder="./auth"
                      className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-brand-inkmuted uppercase tracking-wider mb-2">GROQ API KEY</label>
                    <input
                      type="password"
                      value={configs.GROQ_API_KEY}
                      onChange={(e) => handleChange('GROQ_API_KEY', e.target.value)}
                      placeholder="gsk_..."
                      className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 transition-all font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-brand-inkmuted uppercase tracking-wider mb-2">GEMINI API KEY</label>
                    <input
                      type="password"
                      value={configs.GEMINI_API_KEY}
                      onChange={(e) => handleChange('GEMINI_API_KEY', e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 transition-all font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-brand-inkmuted uppercase tracking-wider mb-2">Puerto de Servidor</label>
                    <input
                      type="text"
                      value={configs.PORT}
                      onChange={(e) => handleChange('PORT', e.target.value)}
                      placeholder="3001"
                      className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-brand-inkmuted uppercase tracking-wider mb-2">CORS Origin</label>
                    <input
                      type="text"
                      value={configs.CORS_ORIGIN}
                      onChange={(e) => handleChange('CORS_ORIGIN', e.target.value)}
                      placeholder="http://localhost:5173"
                      className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/40 transition-all"
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Actions Panel */}
            <div className="flex justify-end gap-3">
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex items-center gap-2 bg-gradient-to-r from-[#1a2949] to-[#101820] hover:from-[#3a5264] hover:to-[#b88c6b] text-white px-8 py-3.5 rounded-xl font-bold text-sm shadow-lg shadow-[#1a2949]/20 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50"
              >
                <Save size={16} />
                {saving ? 'Guardando…' : 'Guardar en .env'}
              </button>
            </div>
            
          </div>

          {/* Sidebar Info/Operations */}
          <div className="space-y-6">
            
            {/* Sync Database Operations */}
            <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-6 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gold" />

              <h3 className="font-serif font-bold text-brand-ink text-sm mb-3 flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-brand-gold/20 text-brand-primary flex items-center justify-center">
                  <Database size={15} />
                </span>
                Base de Datos
              </h3>

              <p className="text-xs text-brand-inkmuted leading-relaxed mb-5">
                Crea automáticamente todas las tablas requeridas por la aplicación en tu cuenta de Supabase/PostgreSQL.
              </p>

              <button
                onClick={handleSyncDb}
                disabled={syncing}
                className="w-full flex items-center justify-center gap-2 bg-[#24365a]/10 hover:bg-[#24365a]/20 text-[#24365a] text-xs font-bold py-3.5 px-4 rounded-xl border border-[#24365a]/20 transition-all duration-200 disabled:opacity-50"
              >
                {syncing ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
                {syncing ? 'Sincronizando…' : 'Sincronizar tablas'}
              </button>
            </div>

            {/* Help / Instructions Box */}
            <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-6">
              <h3 className="font-serif font-bold text-brand-ink text-xs uppercase tracking-wider mb-4 flex items-center gap-2">
                <span className="w-8 h-8 rounded-xl bg-brand-primary/[0.07] text-brand-primary flex items-center justify-center">
                  <HelpCircle size={14} />
                </span>
                Guía rápida
              </h3>

              <div className="space-y-4">
                <div>
                  <h4 className="text-brand-ink text-xs font-semibold mb-1">1. Guardar configuraciones</h4>
                  <p className="text-[11px] text-brand-inkmuted leading-relaxed">
                    Al presionar "Guardar en .env", se grabarán las variables en el archivo local de configuración.
                  </p>
                </div>
                <div>
                  <h4 className="text-brand-ink text-xs font-semibold mb-1">2. Sincronizar Base de Datos</h4>
                  <p className="text-[11px] text-brand-inkmuted leading-relaxed">
                    Usa esta opción para inyectar la estructura inicial (migraciones) de la base de datos automáticamente.
                  </p>
                </div>
                <div>
                  <h4 className="text-brand-ink text-xs font-semibold mb-1">3. Aplicar y Reiniciar</h4>
                  <p className="text-[11px] text-brand-inkmuted leading-relaxed">
                    Hacé click en "Reiniciar Servidor" arriba a la derecha para relanzar la app con las nuevas variables del .env.
                  </p>
                </div>
              </div>
            </div>

            {/* Warning Box */}
            <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-5 flex gap-3">
              <ShieldAlert className="text-amber-500 flex-shrink-0 mt-0.5" size={16} />
              <div>
                <h4 className="text-amber-600 text-xs font-bold mb-1">Seguridad del Sistema</h4>
                <p className="text-[10px] text-brand-inkmuted leading-relaxed">
                  Las credenciales se guardan de forma local en tu servidor. Nunca compartas la clave <code className="bg-black/[0.05] text-brand-ink px-1 rounded">service_role</code> en la red pública.
                </p>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

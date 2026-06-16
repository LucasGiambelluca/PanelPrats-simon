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

  const handleRestart = async () => {
    const confirmRestart = window.confirm(
      '¿Estás seguro de que querés reiniciar la aplicación? Esto aplicará los cambios del archivo .env y desconectará temporalmente el panel por un instante.'
    );
    if (!confirmRestart) return;

    setRestarting(true);
    try {
      const res = await configApi.restart();
      toast.info(res.message || 'Reiniciando el backend...');
      // Wait 3 seconds and reload the page
      setTimeout(() => {
        window.location.reload();
      }, 3000);
    } catch (err: any) {
      toast.error('Error al intentar reiniciar: ' + err.message);
      setRestarting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-[#0b0f1a]">
        <div className="text-center">
          <RefreshCw className="animate-spin text-[#C6AC98] mx-auto mb-4" size={36} />
          <p className="text-slate-400 text-sm">Cargando configuraciones...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0b0f1a] p-6 lg:p-8">
      <div className="max-w-4xl mx-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#304352] to-[#a57b5a] flex items-center justify-center shadow-lg shadow-[#304352]/20">
              <Settings size={22} className="text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Conexiones</h1>
              <p className="text-sm text-slate-500">Configurá las credenciales, bases de datos y servicios externos</p>
            </div>
          </div>
          <button
            onClick={handleRestart}
            disabled={restarting}
            className="flex items-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/15 text-red-400 text-xs font-semibold rounded-xl border border-red-500/20 transition-all duration-200 disabled:opacity-50"
          >
            <RefreshCw size={14} className={restarting ? 'animate-spin' : ''} />
            {restarting ? 'Reiniciando…' : 'Reiniciar Servidor'}
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Main Config Form */}
          <div className="lg:col-span-2 space-y-6">
            
            {/* Supabase & DB section */}
            <div className="bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-bold text-base mb-5 flex items-center gap-2">
                <Database size={18} className="text-[#C6AC98]" />
                Base de Datos y Supabase
              </h2>
              
              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">SUPABASE URL</label>
                  <input
                    type="text"
                    value={configs.SUPABASE_URL}
                    onChange={(e) => handleChange('SUPABASE_URL', e.target.value)}
                    placeholder="https://tu-proyecto.supabase.co"
                    className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C6AC98]/40 transition-all"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">SUPABASE SERVICE ROLE KEY</label>
                  <div className="relative">
                    <Key className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={16} />
                    <input
                      type="password"
                      value={configs.SUPABASE_SERVICE_KEY}
                      onChange={(e) => handleChange('SUPABASE_SERVICE_KEY', e.target.value)}
                      placeholder="eyJhbGciOi..."
                      className="w-full bg-black/20 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C6AC98]/40 transition-all font-mono"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1.5">
                    Debe ser la clave "service_role" para omitir las políticas de RLS al guardar datos del sistema.
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">PostgreSQL DATABASE URL</label>
                  <div className="relative">
                    <Link2 className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-600" size={16} />
                    <input
                      type="text"
                      value={configs.DATABASE_URL}
                      onChange={(e) => handleChange('DATABASE_URL', e.target.value)}
                      placeholder="postgresql://postgres:password@db.supabase.co:5432/postgres"
                      className="w-full bg-black/20 border border-white/10 rounded-xl pl-11 pr-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C6AC98]/40 transition-all font-mono"
                    />
                  </div>
                  <p className="text-[10px] text-slate-500 mt-1.5">
                    Requerida para realizar la sincronización inicial de tablas.
                  </p>
                </div>
              </div>
            </div>

            {/* APIs & Services */}
            <div className="bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-2xl p-6">
              <h2 className="text-white font-bold text-base mb-5 flex items-center gap-2">
                <Server size={18} className="text-[#C6AC98]" />
                Servicios Externos e Infraestructura
              </h2>
              
              <div className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">REDIS URL</label>
                    <input
                      type="text"
                      value={configs.REDIS_URL}
                      onChange={(e) => handleChange('REDIS_URL', e.target.value)}
                      placeholder="redis://127.0.0.1:6379"
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C6AC98]/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Carpeta Auth Baileys</label>
                    <input
                      type="text"
                      value={configs.AUTH_BASE_PATH}
                      onChange={(e) => handleChange('AUTH_BASE_PATH', e.target.value)}
                      placeholder="./auth"
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C6AC98]/40 transition-all"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">GROQ API KEY</label>
                    <input
                      type="password"
                      value={configs.GROQ_API_KEY}
                      onChange={(e) => handleChange('GROQ_API_KEY', e.target.value)}
                      placeholder="gsk_..."
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C6AC98]/40 transition-all font-mono"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">GEMINI API KEY</label>
                    <input
                      type="password"
                      value={configs.GEMINI_API_KEY}
                      onChange={(e) => handleChange('GEMINI_API_KEY', e.target.value)}
                      placeholder="AIzaSy..."
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C6AC98]/40 transition-all font-mono"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">Puerto de Servidor</label>
                    <input
                      type="text"
                      value={configs.PORT}
                      onChange={(e) => handleChange('PORT', e.target.value)}
                      placeholder="3001"
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C6AC98]/40 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-400 uppercase tracking-wider mb-2">CORS Origin</label>
                    <input
                      type="text"
                      value={configs.CORS_ORIGIN}
                      onChange={(e) => handleChange('CORS_ORIGIN', e.target.value)}
                      placeholder="http://localhost:5173"
                      className="w-full bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-sm focus:outline-none focus:ring-2 focus:ring-[#C6AC98]/40 transition-all"
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
                className="flex items-center gap-2 bg-gradient-to-r from-[#304352] to-[#a57b5a] hover:from-[#3a5264] hover:to-[#b88c6b] text-white px-8 py-3.5 rounded-xl font-bold text-sm shadow-lg shadow-[#304352]/20 transition-all duration-200 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-50"
              >
                <Save size={16} />
                {saving ? 'Guardando…' : 'Guardar en .env'}
              </button>
            </div>
            
          </div>

          {/* Sidebar Info/Operations */}
          <div className="space-y-6">
            
            {/* Sync Database Operations */}
            <div className="bg-gradient-to-br from-[#304352]/25 to-[#a57b5a]/15 border border-[#C6AC98]/20 rounded-2xl p-6 relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-[#C6AC98]/5 rounded-full blur-2xl pointer-events-none" />
              
              <h3 className="text-white font-bold text-sm mb-3 flex items-center gap-2">
                <Database size={16} className="text-[#C6AC98]" />
                Base de Datos
              </h3>
              
              <p className="text-xs text-slate-400 leading-relaxed mb-5">
                Crea automáticamente todas las tablas requeridas por la aplicación en tu cuenta de Supabase/PostgreSQL.
              </p>

              <button
                onClick={handleSyncDb}
                disabled={syncing}
                className="w-full flex items-center justify-center gap-2 bg-[#C6AC98]/10 hover:bg-[#C6AC98]/20 text-[#C6AC98] text-xs font-bold py-3.5 px-4 rounded-xl border border-[#C6AC98]/20 transition-all duration-200 disabled:opacity-50"
              >
                {syncing ? <RefreshCw size={14} className="animate-spin" /> : <Database size={14} />}
                {syncing ? 'Sincronizando…' : 'Sincronizar tablas'}
              </button>
            </div>

            {/* Help / Instructions Box */}
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6">
              <h3 className="text-white font-bold text-xs uppercase tracking-wider mb-4 flex items-center gap-2">
                <HelpCircle size={14} className="text-slate-500" />
                Guía rápida
              </h3>

              <div className="space-y-4">
                <div>
                  <h4 className="text-white text-xs font-semibold mb-1">1. Guardar configuraciones</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Al presionar "Guardar en .env", se grabarán las variables en el archivo local de configuración.
                  </p>
                </div>
                <div>
                  <h4 className="text-white text-xs font-semibold mb-1">2. Sincronizar Base de Datos</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Usa esta opción para inyectar la estructura inicial (migraciones) de la base de datos automáticamente.
                  </p>
                </div>
                <div>
                  <h4 className="text-white text-xs font-semibold mb-1">3. Aplicar y Reiniciar</h4>
                  <p className="text-[11px] text-slate-500 leading-relaxed">
                    Hacé click en "Reiniciar Servidor" arriba a la derecha para relanzar la app con las nuevas variables del .env.
                  </p>
                </div>
              </div>
            </div>

            {/* Warning Box */}
            <div className="bg-amber-500/5 border border-amber-500/10 rounded-2xl p-5 flex gap-3">
              <ShieldAlert className="text-amber-500 flex-shrink-0 mt-0.5" size={16} />
              <div>
                <h4 className="text-amber-400 text-xs font-bold mb-1">Seguridad del Sistema</h4>
                <p className="text-[10px] text-slate-500 leading-relaxed">
                  Las credenciales se guardan de forma local en tu servidor. Nunca compartas la clave <code className="bg-black/40 text-slate-400 px-1 rounded">service_role</code> en la red pública.
                </p>
              </div>
            </div>

          </div>
        </div>

      </div>
    </div>
  );
}

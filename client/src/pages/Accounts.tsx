import { useState, useEffect, useRef, useCallback } from 'react';
import { useAccounts } from '../context/AccountContext';
import { accountsApi, flowsApi, apiBase } from '../lib/api';
import type { Account, Flow } from '../types';
import { toast } from 'sonner';
import {
  Plus, Wifi, WifiOff, QrCode, Loader2, Smartphone,
  RefreshCw, X, CheckCircle, Signal, PhoneOff,
  MessageCircle, Facebook, Instagram, Settings2, Check, HelpCircle, Trash2, Bot
} from 'lucide-react';

type Channel = 'whatsapp' | 'facebook' | 'instagram';

const channelConfig: Record<Channel, { label: string; icon: any; color: string }> = {
  whatsapp:  { label: 'WhatsApp',  icon: MessageCircle, color: 'bg-[#24365a]/10 text-[#24365a] border-[#24365a]/20' },
  facebook:  { label: 'Facebook',  icon: Facebook,      color: 'bg-blue-400/10 text-blue-600 border-blue-400/20' },
  instagram: { label: 'Instagram', icon: Instagram,     color: 'bg-pink-400/10 text-pink-600 border-pink-400/20' },
};

const statusConfig: Record<string, { color: string; dotColor: string; icon: any; label: string }> = {
  connected:    { color: 'bg-emerald-500/10 text-emerald-600 border-emerald-500/20', dotColor: 'bg-emerald-400', icon: Wifi, label: 'Conectado' },
  disconnected: { color: 'bg-slate-400/10 text-slate-500 border-slate-400/20', dotColor: 'bg-slate-500', icon: WifiOff, label: 'Desconectado' },
  qr:           { color: 'bg-amber-400/10 text-amber-600 border-amber-400/20', dotColor: 'bg-amber-400', icon: QrCode, label: 'Esperando QR' },
  connecting:   { color: 'bg-brand-secondary/10 text-brand-secondary border-brand-secondary/20', dotColor: 'bg-brand-secondary', icon: Loader2, label: 'Conectando…' },
};

export default function Accounts() {
  const { accounts, createAccount, updateAccount, deleteAccount, reload } = useAccounts();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [channel, setChannel] = useState<Channel>('whatsapp');
  
  // WhatsApp connection method state
  const [provider, setProvider] = useState<'baileys' | 'official'>('baileys');

  // Credentials states
  const [externalId, setExternalId] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [appSecret, setAppSecret] = useState('');
  const [verifyToken, setVerifyToken] = useState('');
  const [creating, setCreating] = useState(false);
  
  // Edit Modal states
  const [editingAccount, setEditingAccount] = useState<Account | null>(null);
  const [editName, setEditName] = useState('');
  const [editProvider, setEditProvider] = useState<'baileys' | 'official'>('baileys');
  const [editFlowId, setEditFlowId] = useState<string | null>(null);
  const [editReminderMinutes, setEditReminderMinutes] = useState<number>(20);
  const [editExternalId, setEditExternalId] = useState('');
  const [editAccessToken, setEditAccessToken] = useState('');
  const [editAppSecret, setEditAppSecret] = useState('');
  const [editVerifyToken, setEditVerifyToken] = useState('');
  // Agente IA de soporte global
  const [editAiEnabled, setEditAiEnabled] = useState(false);
  const [editAiApiKey, setEditAiApiKey] = useState('');
  const [editAiModel, setEditAiModel] = useState('gpt-4o-mini');
  const [editAiPrompt, setEditAiPrompt] = useState('');
  const [saving, setSaving] = useState(false);

  // Flows listing state
  const [allFlows, setAllFlows] = useState<Flow[]>([]);

  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [connectStatus, setConnectStatus] = useState<string>('');
  const [hasAutoPolled, setHasAutoPolled] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopPolling = useCallback(() => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
  }, []);

  // Cleanup on unmount
  useEffect(() => () => stopPolling(), [stopPolling]);

  // Load all flows
  const loadFlows = useCallback(async () => {
    try {
      const list = await flowsApi.list('');
      setAllFlows(list);
    } catch (err) {
      console.error('Error listing flows:', err);
    }
  }, []);

  useEffect(() => {
    loadFlows();
  }, [accounts, loadFlows]);


  const handleCreate = async () => {
    if (!name.trim()) return;
    setCreating(true);
    try {
      const opts = channel === 'whatsapp'
        ? {
            channel,
            provider,
            external_id: provider === 'official' ? externalId.trim() : undefined,
            access_token: provider === 'official' ? accessToken.trim() : undefined,
            app_secret: provider === 'official' ? appSecret.trim() : undefined,
            verify_token: provider === 'official' ? verifyToken.trim() : undefined,
          }
        : {
            channel,
            external_id: externalId.trim() || undefined,
            access_token: accessToken.trim() || undefined,
            app_secret: appSecret.trim() || undefined,
            verify_token: verifyToken.trim() || undefined,
          };
      await createAccount(name.trim(), opts);
      setName('');
      setExternalId(''); setAccessToken(''); setAppSecret(''); setVerifyToken('');
      setChannel('whatsapp');
      setProvider('baileys');
      toast.success('Línea de atención creada');
      reload();
    } catch (err: any) {
      toast.error('Error: ' + (err.message || 'No se pudo crear'));
    }
    setCreating(false);
  };

  const openEditModal = (acc: Account) => {
    setEditingAccount(acc);
    setEditName(acc.name);
    setEditProvider(acc.provider || 'baileys');
    setEditFlowId(acc.flow_id || null);
    setEditReminderMinutes(acc.reminder_minutes ?? 20);
    setEditExternalId(acc.external_id || '');
    setEditAccessToken(acc.access_token || '');
    setEditAppSecret(acc.app_secret || '');
    setEditVerifyToken(acc.verify_token || '');
    setEditAiEnabled(!!acc.ai_support_enabled);
    setEditAiApiKey(acc.ai_api_key || '');
    setEditAiModel(acc.ai_model || 'gpt-4o-mini');
    setEditAiPrompt(acc.ai_support_prompt || '');
  };

  const handleSaveEdit = async () => {
    if (!editingAccount) return;
    setSaving(true);
    try {
      await updateAccount(editingAccount.id, {
        name: editName.trim(),
        provider: editProvider,
        flow_id: editFlowId || null,
        reminder_minutes: editReminderMinutes,
        external_id: editExternalId.trim() || null,
        access_token: editAccessToken.trim() || null,
        app_secret: editAppSecret.trim() || null,
        verify_token: editVerifyToken.trim() || null,
        ai_support_enabled: editAiEnabled,
        ai_api_key: editAiApiKey.trim() || null,
        ai_model: editAiModel.trim() || 'gpt-4o-mini',
        ai_support_prompt: editAiPrompt.trim() || null,
      });
      toast.success('Configuración guardada correctamente');
      setEditingAccount(null);
      reload();
    } catch (err: any) {
      toast.error('Error al guardar configuración: ' + (err.message || ''));
    } finally {
      setSaving(false);
    }
  };

  const pollQr = useCallback(async (accountId: string) => {
    try {
      const res = await accountsApi.qr(accountId);
      setConnectStatus(res.status);

      if (res.status === 'connected') {
        stopPolling();
        setQrDataUrl(null);
        toast.success('¡Línea conectada con éxito!');
        reload();
        setTimeout(() => setConnectingId(null), 1500);
      } else if (res.qr) {
        setQrDataUrl(res.qr);
      }
    } catch (err) {
      console.error('[Accounts] poll error:', err);
    }
  }, [stopPolling, reload]);

  // Auto-start polling if an account is in 'qr' status on page load
  useEffect(() => {
    if (accounts.length > 0 && !hasAutoPolled) {
      const qrAccount = accounts.find(a => a.status === 'qr' && a.provider !== 'official' && (!a.channel || a.channel === 'whatsapp'));
      if (qrAccount) {
        setConnectingId(qrAccount.id);
        setConnectStatus('qr');
        if (qrAccount.qr_code) {
          setQrDataUrl(qrAccount.qr_code);
        }
        pollRef.current = setInterval(() => pollQr(qrAccount.id), 2000);
        pollQr(qrAccount.id);
      }
      setHasAutoPolled(true);
    }
  }, [accounts, hasAutoPolled, pollQr]);

  const handleConnect = async (accountId: string) => {
    setConnectingId(accountId);
    setQrDataUrl(null);
    setConnectStatus('connecting');

    try {
      await accountsApi.connect(accountId);
      stopPolling();
      pollRef.current = setInterval(() => pollQr(accountId), 2000);
      await pollQr(accountId);
    } catch (err: any) {
      toast.error('Error al conectar: ' + (err.message || ''));
      setConnectingId(null);
    }
  };

  const handleDisconnect = async (accountId: string) => {
    try {
      await accountsApi.disconnect(accountId);
      toast.info('Línea desconectada');
      reload();
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const doDelete = async (a: Account) => {
    setDeletingId(a.id);
    try {
      await deleteAccount(a.id);
      toast.success(`Línea "${a.name}" eliminada`);
    } catch (err: any) {
      toast.error('Error al eliminar: ' + (err.message || 'desconocido'));
    } finally {
      setDeletingId(null);
    }
  };

  // Confirmación vía toast (sonner) en vez de window.confirm, que el navegador
  // puede bloquear tras varios diálogos ("no permitir más cuadros de diálogo").
  const handleDelete = (a: Account) => {
    toast(`¿Eliminar "${a.name}"? Borra sus flujos, conversaciones y mensajes.`, {
      duration: 10000,
      action: { label: 'Eliminar', onClick: () => doDelete(a) },
      cancel: { label: 'Cancelar', onClick: () => {} },
    });
  };

  const closeQrPanel = () => {
    stopPolling();
    setConnectingId(null);
    setQrDataUrl(null);
  };

  return (
    <div className="min-h-screen bg-brand-ivory p-6 lg:p-8 font-sans">
      <div className="max-w-6xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-8 border-b border-brand-hairline pb-6">
          <div className="flex items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#1a2949] to-[#101820] flex items-center justify-center shadow-lg shadow-brand-secondary/10">
              <Smartphone size={22} className="text-[#24365a]" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-brand-ink tracking-tight font-serif">Gestión de Líneas</h1>
              <p className="text-sm text-brand-inkmuted">Configuración y asignación de flujos de atención para el bufete Prats & Simon</p>
            </div>
          </div>
          <button onClick={() => { reload(); loadFlows(); }} className="text-[#101820] hover:text-brand-ink transition-colors p-2.5 rounded-xl bg-black/[0.03] border border-brand-hairline hover:bg-black/[0.06]">
            <RefreshCw size={18} />
          </button>
        </div>

        {/* Create Account Branded Card */}
        <div className="glass-card rounded-2xl p-6 mb-8 border border-brand-hairline relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-[#24365a]/5 rounded-full blur-3xl pointer-events-none" />

          <h2 className="text-brand-ink font-serif font-bold text-lg mb-4">Nueva Línea de Atención</h2>

          <div className="space-y-4">
            {/* Channel selector */}
            <div className="flex gap-2">
              {(Object.keys(channelConfig) as Channel[]).map((ch) => {
                const ChIcon = channelConfig[ch].icon;
                const active = channel === ch;
                return (
                  <button
                    key={ch}
                    type="button"
                    onClick={() => { setChannel(ch); setProvider('baileys'); }}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold border transition-all duration-300 ${
                      active
                        ? channelConfig[ch].color
                        : 'bg-black/[0.03] text-slate-500 border-brand-hairline hover:text-brand-ink hover:border-brand-hairline'
                    }`}
                  >
                    <ChIcon size={15} />
                    {channelConfig[ch].label}
                  </button>
                );
              })}
            </div>

            {/* Connection method selection for WhatsApp */}
            {channel === 'whatsapp' && (
              <div className="bg-black/[0.03] border border-brand-hairline p-1 rounded-xl flex max-w-md gap-1">
                <button
                  type="button"
                  onClick={() => setProvider('baileys')}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                    provider === 'baileys'
                      ? 'bg-brand-secondary text-white shadow-md font-bold'
                      : 'text-brand-inkmuted hover:text-brand-ink'
                  }`}
                >
                  Código QR (Baileys)
                </button>
                <button
                  type="button"
                  onClick={() => setProvider('official')}
                  className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                    provider === 'official'
                      ? 'bg-brand-secondary text-white shadow-md font-bold'
                      : 'text-brand-inkmuted hover:text-brand-ink'
                  }`}
                >
                  API Oficial (Meta)
                </button>
              </div>
            )}

            <div className="flex flex-col md:flex-row gap-3">
              <div className="flex-1 relative">
                <Smartphone size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  className="w-full bg-white border border-brand-hairline rounded-xl pl-11 pr-4 py-3.5 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/30 transition-all"
                  placeholder="Nombre de la línea (ej: Recepción Principal, Consultas Civiles, Consultas Penales…)"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && (channel !== 'whatsapp' || provider === 'baileys') && handleCreate()}
                />
              </div>
              <button
                onClick={handleCreate}
                disabled={creating || !name.trim()}
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-[#1a2949] to-[#101820] hover:from-[#3a5264] hover:to-[#b88c6b] text-white px-7 py-3.5 rounded-xl font-bold text-sm shadow-md transition-all duration-300 hover:-translate-y-0.5 active:scale-[0.98] disabled:opacity-40 disabled:hover:translate-y-0 whitespace-nowrap"
              >
                <Plus size={16} />
                Crear Línea
              </button>
            </div>

            {/* Meta config or Official WhatsApp credentials form */}
            {(channel !== 'whatsapp' || provider === 'official') && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 border-t border-brand-hairline pt-4 animate-fade-in">
                <div className="space-y-1">
                  <label className="text-xs text-brand-inkmuted font-semibold">
                    {channel === 'whatsapp' ? 'Phone Number ID' : channel === 'instagram' ? 'Instagram Account ID' : 'Facebook Page ID'}
                  </label>
                  <input
                    className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/30 transition-all"
                    placeholder="ej: 105655982348574"
                    value={externalId}
                    onChange={(e) => setExternalId(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-brand-inkmuted font-semibold">Access Token</label>
                  <input
                    className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/30 transition-all"
                    placeholder="Token permanente de Meta Graph API"
                    value={accessToken}
                    onChange={(e) => setAccessToken(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-brand-inkmuted font-semibold">App Secret</label>
                  <input
                    className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/30 transition-all"
                    placeholder="Firma secreta para verificar webhook"
                    value={appSecret}
                    onChange={(e) => setAppSecret(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs text-brand-inkmuted font-semibold">Verify Token</label>
                  <input
                    className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/30 transition-all"
                    placeholder="Token de verificación arbitrario para configurar webhook"
                    value={verifyToken}
                    onChange={(e) => setVerifyToken(e.target.value)}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Lines Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {accounts.map((a) => {
            const cfg = statusConfig[a.status] || statusConfig.disconnected;
            const StatusIcon = cfg.icon;
            const isConnecting = connectingId === a.id;
            const isMeta = !!a.channel && a.channel !== 'whatsapp';
            const isOfficial = a.provider === 'official';
            const activeFlow = allFlows.find(f => f.id === a.flow_id);

            return (
              <div
                key={a.id}
                className={`glass-card rounded-2xl overflow-hidden border transition-all duration-300 relative group ${
                  isConnecting
                    ? 'border-brand-secondary/40 shadow-lg shadow-brand-secondary/5 col-span-1 md:col-span-2 lg:col-span-3'
                    : 'border-brand-hairline hover:border-brand-secondary/30 hover:bg-black/[0.03]'
                }`}
              >
                {/* Decorative gold-glow line on hover */}
                <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#24365a]/40 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

                {/* Card Main Area */}
                <div className={`p-5 flex flex-col ${isConnecting ? '' : 'h-full'} justify-between`}>
                  <div>
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[#1a2949]/30 to-[#101820]/30 border border-brand-hairline flex items-center justify-center relative">
                          <Smartphone size={22} className="text-[#101820]" />
                          <div className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-brand-surface ${cfg.dotColor} ${
                            a.status === 'qr' || a.status === 'connecting' ? 'animate-pulse' : ''
                          }`} />
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-serif font-bold text-brand-ink text-base leading-tight">{a.name}</h3>
                            {(() => {
                              const chCfg = channelConfig[(a.channel as Channel) || 'whatsapp'];
                              const ChIcon = chCfg.icon;
                              return (
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold border ${chCfg.color}`}>
                                  <ChIcon size={10} />
                                  {chCfg.label}
                                </span>
                              );
                            })()}
                          </div>
                          <span className="text-[10px] text-brand-inkmuted uppercase tracking-wider mt-1 block">
                            {isMeta ? 'Meta Webhook' : isOfficial ? 'WhatsApp API Oficial' : 'Baileys Código QR'}
                          </span>
                        </div>
                      </div>

                      <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[11px] font-semibold border ${cfg.color}`}>
                        <StatusIcon size={11} className={a.status === 'connecting' ? 'animate-spin' : ''} />
                        {cfg.label}
                      </span>
                    </div>

                    {/* Flow routing assignment status */}
                    <div className="mt-4 p-3 bg-brand-panel border border-brand-hairline rounded-xl">
                      <span className="text-[11px] text-brand-inkmuted block uppercase tracking-wider mb-1 font-semibold">Flujo de Atención Asignado:</span>
                      {activeFlow ? (
                        <div className="flex items-center gap-2 text-brand-ink text-sm font-semibold">
                          <Check size={14} className="text-[#101820]" />
                          <span>{activeFlow.name}</span>
                          {activeFlow.trigger_word && (
                            <span className="text-xs text-brand-inkmuted font-normal">({activeFlow.trigger_word})</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-slate-500 italic block">Sin asignar (usa iniciador inteligente / webhook)</span>
                      )}
                    </div>

                    <p className="text-xs text-brand-inkmuted font-mono mt-3">
                      {a.phone_number || (a.channel && a.channel !== 'whatsapp' ? `ID: ${a.external_id || 'Sin ID'}` : 'Sin número vinculado')}
                    </p>
                  </div>

                  {/* Actions buttons */}
                  <div className="flex gap-2 mt-4 pt-3 border-t border-brand-hairline">
                    <button
                      onClick={() => openEditModal(a)}
                      className="flex items-center justify-center p-2.5 bg-black/[0.03] hover:bg-black/[0.06] text-[#101820] rounded-xl border border-brand-hairline transition-all"
                      title="Configurar línea y flujo"
                    >
                      <Settings2 size={15} />
                    </button>

                    <button
                      onClick={() => handleDelete(a)}
                      disabled={deletingId === a.id}
                      className="flex items-center justify-center p-2.5 bg-red-500/[0.06] hover:bg-red-500/15 text-red-600 rounded-xl border border-red-500/20 transition-all disabled:opacity-50"
                      title="Eliminar línea"
                    >
                      {deletingId === a.id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                    </button>

                    {a.status === 'connected' ? (
                      <button
                        onClick={() => handleDisconnect(a.id)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-500/10 hover:bg-red-500/15 text-red-600 text-xs font-semibold rounded-xl border border-red-500/20 transition-all duration-200"
                      >
                        <PhoneOff size={14} />
                        Desconectar
                      </button>
                    ) : (isMeta || isOfficial) ? (
                      <button
                        onClick={() => setConnectingId(isConnecting ? null : a.id)}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-secondary/10 hover:bg-brand-secondary/15 text-brand-secondary text-xs font-semibold rounded-xl border border-brand-secondary/20 transition-all duration-200"
                      >
                        <Signal size={14} />
                        {isConnecting ? 'Ocultar Webhook' : 'Configurar Webhook'}
                      </button>
                    ) : (
                      <button
                        onClick={() => handleConnect(a.id)}
                        disabled={isConnecting}
                        className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-brand-secondary/10 hover:bg-brand-secondary/15 text-brand-secondary text-xs font-semibold rounded-xl border border-brand-secondary/20 transition-all duration-200 disabled:opacity-50"
                      >
                        <Signal size={14} />
                        {isConnecting ? 'Conectando…' : 'Conectar QR'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Instructions panel for meta webhook / WhatsApp Official */}
                {isConnecting && (isMeta || isOfficial) && (
                  <div className="border-t border-brand-hairline bg-gradient-to-b from-[#24365a]/5 to-transparent p-6 animate-fade-in col-span-1 md:col-span-2 lg:col-span-3">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h4 className="text-brand-ink font-bold text-sm">Configurar Webhook en Meta</h4>
                        <p className="text-brand-inkmuted text-xs mt-0.5">Pegá estos parámetros en Meta Business Suite para canalizar los mensajes</p>
                      </div>
                      <button onClick={closeQrPanel} className="text-slate-500 hover:text-brand-ink transition-colors p-1">
                        <X size={18} />
                      </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wide mb-1">Webhook URL</p>
                        <code className="block bg-brand-panel border border-brand-hairline rounded-lg px-3 py-2.5 text-[#101820] text-xs font-mono break-all">
                          {apiBase}/api/webhooks/meta
                        </code>
                      </div>
                      <div>
                        <p className="text-slate-500 text-[11px] font-semibold uppercase tracking-wide mb-1">Verify Token</p>
                        <code className="block bg-brand-panel border border-brand-hairline rounded-lg px-3 py-2.5 text-brand-secondary text-xs font-mono break-all">
                          {a.verify_token || '— (definí un Verify Token al configurar la línea)'}
                        </code>
                      </div>
                    </div>

                    <div className="mt-4 p-3.5 bg-[#24365a]/5 rounded-xl border border-[#24365a]/10 text-xs text-brand-inkmuted leading-relaxed flex items-start gap-2.5">
                      <HelpCircle size={16} className="text-[#101820] flex-shrink-0 mt-0.5" />
                      <div>
                        <span className="font-bold text-brand-ink block mb-0.5">¿Cómo configurar?</span>
                        Ve a la sección Webhooks de tu app de Meta Developer, selecciona <span className="text-brand-ink font-semibold">{isOfficial ? 'WhatsApp Business Account' : 'Page'}</span>, añade la URL y el Token de verificación anteriores, y suscríbete al campo <span className="text-brand-ink font-semibold">messages</span>.
                      </div>
                    </div>
                  </div>
                )}

                {/* QR Code panel for Baileys WhatsApp */}
                {isConnecting && !isMeta && !isOfficial && (
                  <div className="border-t border-brand-hairline bg-gradient-to-b from-[#24365a]/5 to-transparent p-6 animate-fade-in col-span-1 md:col-span-2 lg:col-span-3">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <h4 className="text-brand-ink font-bold text-sm">Vincular WhatsApp por Código QR</h4>
                        <p className="text-brand-inkmuted text-xs mt-0.5">Escaneá el código utilizando WhatsApp Web en tu teléfono</p>
                      </div>
                      <button onClick={closeQrPanel} className="text-slate-500 hover:text-brand-ink transition-colors p-1">
                        <X size={18} />
                      </button>
                    </div>

                    <div className="flex flex-col md:flex-row items-center gap-8 justify-center">
                      <div className="flex-shrink-0">
                        {connectStatus === 'connected' ? (
                          <div className="w-60 h-60 bg-emerald-500/10 rounded-2xl flex flex-col items-center justify-center gap-3 border border-emerald-500/20">
                            <CheckCircle size={56} className="text-emerald-600 animate-bounce" />
                            <p className="text-emerald-600 font-bold text-sm">¡Conectado!</p>
                          </div>
                        ) : (qrDataUrl || a.qr_code) ? (
                          <div className="w-60 h-60 bg-white rounded-2xl p-3 shadow-lg shadow-black/5 relative overflow-hidden flex items-center justify-center border border-brand-hairline">
                            <img
                              src={(qrDataUrl || a.qr_code)!.startsWith('data:') ? (qrDataUrl || a.qr_code)! : `data:image/png;base64,${qrDataUrl || a.qr_code}`}
                              alt="QR Code"
                              className="w-full h-full object-contain rounded-xl"
                            />
                            <div className="absolute left-3 right-3 h-[2px] bg-gradient-to-r from-transparent via-[#24365a] to-transparent animate-scan-line" />
                          </div>
                        ) : (
                          <div className="w-60 h-60 bg-brand-panel rounded-2xl flex items-center justify-center border border-brand-hairline">
                            <Loader2 size={40} className="text-[#101820] animate-spin" />
                          </div>
                        )}
                      </div>

                      <div className="flex-1 space-y-4 max-w-sm">
                        <div className="space-y-3">
                          {[
                            { step: '1', text: 'Abre WhatsApp en tu teléfono móvil' },
                            { step: '2', text: 'Toca Menú o Configuración y selecciona Dispositivos Vinculados' },
                            { step: '3', text: 'Toca Vincular un Dispositivo' },
                            { step: '4', text: 'Apunta la cámara del móvil a la pantalla para escanear' },
                          ].map((item) => (
                            <div key={item.step} className="flex items-center gap-3">
                              <div className="w-6 h-6 rounded-full bg-[#24365a]/10 flex items-center justify-center flex-shrink-0 border border-[#24365a]/20">
                                <span className="text-[#101820] text-[11px] font-bold">{item.step}</span>
                              </div>
                              <p className="text-brand-inkmuted text-xs">{item.text}</p>
                            </div>
                          ))}
                        </div>

                        {qrDataUrl && (
                          <div className="inline-flex items-center gap-2 bg-amber-500/10 border border-amber-500/20 rounded-full px-3.5 py-1.5">
                            <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                            <span className="text-amber-600 text-[11px] font-semibold">Esperando escaneo del código…</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Empty state */}
        {accounts.length === 0 && (
          <div className="text-center py-24 glass-card rounded-2xl border border-brand-hairline">
            <div className="w-20 h-20 rounded-2xl bg-black/[0.03] border border-brand-hairline flex items-center justify-center mx-auto mb-5 text-[#101820]">
              <Smartphone size={36} />
            </div>
            <h3 className="text-brand-ink font-serif font-bold text-lg mb-1">No hay líneas configuradas</h3>
            <p className="text-brand-inkmuted text-sm max-w-md mx-auto">
              Crea una línea de atención utilizando WhatsApp o canales de Meta en el formulario superior para comenzar a interactuar.
            </p>
          </div>
        )}
      </div>

      {/* Branded Edit Configuration Drawer/Modal */}
      {editingAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-fade-in">
          <div className="glass-card rounded-2xl border border-brand-hairline max-w-lg w-full overflow-hidden shadow-2xl relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-[#24365a]/5 rounded-full blur-3xl pointer-events-none" />

            {/* Modal Header */}
            <div className="flex items-center justify-between p-5 border-b border-brand-hairline">
              <div>
                <h3 className="text-brand-ink font-serif font-bold text-lg">Configurar Línea</h3>
                <p className="text-xs text-brand-inkmuted mt-0.5">Ajustes generales, proveedor y asignación de bot</p>
              </div>
              <button
                onClick={() => setEditingAccount(null)}
                className="text-slate-500 hover:text-brand-ink transition-colors p-1 rounded-lg hover:bg-black/[0.04]"
              >
                <X size={18} />
              </button>
            </div>

            {/* Modal Body */}
            <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
              
              {/* Line Name */}
              <div className="space-y-1">
                <label className="text-xs text-brand-inkmuted font-bold uppercase tracking-wider">Nombre de la línea</label>
                <input
                  className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm focus:outline-none focus:ring-2 focus:ring-[#24365a]/30"
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                />
              </div>

              {/* Provider method for WhatsApp */}
              {editingAccount.channel === 'whatsapp' && (
                <div className="space-y-2">
                  <label className="text-xs text-brand-inkmuted font-bold uppercase tracking-wider block">Método de Conexión</label>
                  <div className="bg-black/[0.03] border border-brand-hairline p-1 rounded-xl flex gap-1">
                    <button
                      type="button"
                      onClick={() => setEditProvider('baileys')}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                        editProvider === 'baileys'
                          ? 'bg-brand-secondary text-white shadow-md font-bold'
                          : 'text-brand-inkmuted hover:text-brand-ink'
                      }`}
                    >
                      Código QR (Baileys)
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditProvider('official')}
                      className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
                        editProvider === 'official'
                          ? 'bg-brand-secondary text-white shadow-md font-bold'
                          : 'text-brand-inkmuted hover:text-brand-ink'
                      }`}
                    >
                      API Oficial (Meta)
                    </button>
                  </div>
                </div>
              )}

              {/* Flow Selector */}
              <div className="space-y-1">
                <label className="text-xs text-brand-inkmuted font-bold uppercase tracking-wider block">Flujo Activo Mapeado</label>
                <select
                  className="w-full bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm focus:outline-none focus:ring-2 focus:ring-[#24365a]/30 appearance-none cursor-pointer"
                  value={editFlowId || ''}
                  onChange={(e) => setEditFlowId(e.target.value || null)}
                >
                  <option value="" className="bg-white text-slate-500">Ninguno (usa iniciador inteligente / wildcard)</option>
                  {allFlows
                    .filter(f => f.is_active)
                    .map(f => (
                      <option key={f.id} value={f.id} className="bg-white text-brand-ink">
                        {f.name} {f.trigger_word ? `(${f.trigger_word})` : ''}
                      </option>
                    ))
                  }
                </select>
                <p className="text-[10px] text-brand-inkmuted mt-1">
                  Cuando la línea reciba un mensaje que inicie conversación, ejecutará este flujo directamente.
                </p>
              </div>

              {/* Recordatorio de citas: anticipación */}
              <div className="space-y-1">
                <label className="text-xs text-brand-inkmuted font-bold uppercase tracking-wider block">Recordatorio de citas (anticipación)</label>
                <select
                  className="w-full bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm focus:outline-none focus:ring-2 focus:ring-[#24365a]/30 appearance-none cursor-pointer"
                  value={editReminderMinutes}
                  onChange={(e) => setEditReminderMinutes(Number(e.target.value))}
                >
                  <option value={20} className="bg-white text-brand-ink">20 minutos antes</option>
                  <option value={60} className="bg-white text-brand-ink">60 minutos antes</option>
                </select>
                <p className="text-[10px] text-brand-inkmuted mt-1">
                  Se envía solo si el cliente escribió en las últimas 24h (ventana de WhatsApp).
                </p>
              </div>

              {/* Agente IA de soporte global */}
              <div className="space-y-3 border-t border-brand-hairline pt-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Bot size={15} className="text-[#101820]" />
                    <label className="text-xs text-brand-inkmuted font-bold uppercase tracking-wider">Agente IA de soporte</label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditAiEnabled(v => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${editAiEnabled ? 'bg-[#101820]' : 'bg-black/[0.12]'}`}
                    title={editAiEnabled ? 'Activado' : 'Desactivado'}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${editAiEnabled ? 'translate-x-5' : ''}`} />
                  </button>
                </div>
                <p className="text-[10px] text-brand-inkmuted -mt-1">
                  Cuando un mensaje no encaja en el flujo (off-script o respuesta inesperada), el agente entiende la intención y rutea al flujo correcto, o deriva a un humano.
                </p>

                {editAiEnabled && (
                  <div className="space-y-3 animate-fade-in">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <label className="text-[11px] text-brand-inkmuted font-semibold">API Key (OpenAI)</label>
                        <input
                          type="password"
                          className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-2.5 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#24365a]/30"
                          placeholder="sk-..."
                          value={editAiApiKey}
                          onChange={(e) => setEditAiApiKey(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-[11px] text-brand-inkmuted font-semibold">Modelo</label>
                        <input
                          className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-2.5 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#24365a]/30"
                          placeholder="gpt-4o-mini"
                          value={editAiModel}
                          onChange={(e) => setEditAiModel(e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="space-y-1">
                      <label className="text-[11px] text-brand-inkmuted font-semibold">Prompt del agente de soporte</label>
                      <textarea
                        className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-2.5 text-brand-ink text-sm min-h-[70px] placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-[#24365a]/30 resize-none leading-relaxed"
                        placeholder="Ej: Sos el asistente de soporte del estudio. Entendés qué necesita la persona y la derivás al flujo correcto."
                        value={editAiPrompt}
                        onChange={(e) => setEditAiPrompt(e.target.value)}
                      />
                      <p className="text-[10px] text-brand-inkmuted">Si lo dejás vacío, usa un prompt genérico. La key/modelo solo se usan para este ruteo.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Credentials fields if official / Meta */}
              {(editingAccount.channel !== 'whatsapp' || editProvider === 'official') && (
                <div className="space-y-4 border-t border-brand-hairline pt-4">
                  <div className="space-y-1">
                    <label className="text-xs text-brand-inkmuted font-semibold">
                      {editingAccount.channel === 'whatsapp' ? 'Phone Number ID' : editingAccount.channel === 'instagram' ? 'Instagram Account ID' : 'Facebook Page ID'}
                    </label>
                    <input
                      className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-2.5 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/30"
                      placeholder="Identificador ID de Meta"
                      value={editExternalId}
                      onChange={(e) => setEditExternalId(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-brand-inkmuted font-semibold">Access Token</label>
                    <input
                      className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-2.5 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/30"
                      placeholder="Access token de Meta Graph"
                      value={editAccessToken}
                      onChange={(e) => setEditAccessToken(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-brand-inkmuted font-semibold">App Secret</label>
                    <input
                      className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-2.5 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/30"
                      placeholder="Secreto de la app de Meta"
                      value={editAppSecret}
                      onChange={(e) => setEditAppSecret(e.target.value)}
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs text-brand-inkmuted font-semibold">Verify Token</label>
                    <input
                      className="w-full bg-white border border-brand-hairline rounded-xl px-4 py-2.5 text-brand-ink text-sm placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-secondary/30"
                      placeholder="Token de verificación webhook"
                      value={editVerifyToken}
                      onChange={(e) => setEditVerifyToken(e.target.value)}
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer */}
            <div className="flex gap-3 p-5 border-t border-brand-hairline bg-brand-panel justify-end">
              <button
                type="button"
                onClick={() => setEditingAccount(null)}
                className="px-5 py-2.5 bg-black/[0.03] hover:bg-black/[0.06] text-brand-inkmuted rounded-xl border border-brand-hairline text-xs font-semibold transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveEdit}
                disabled={saving || !editName.trim()}
                className="flex items-center gap-1.5 bg-gradient-to-r from-[#1a2949] to-[#101820] hover:from-[#3a5264] hover:to-[#b88c6b] text-white px-6 py-2.5 rounded-xl font-bold text-xs shadow-md transition-all duration-300 disabled:opacity-40"
              >
                {saving ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Guardando…
                  </>
                ) : (
                  <>
                    <Check size={12} />
                    Guardar Cambios
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

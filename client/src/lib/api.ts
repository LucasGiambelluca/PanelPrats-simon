import { supabase } from '../supabaseClient';

// Sin VITE_API_URL → relativo: el front llama /api y vite lo proxyea al backend
const BASE = import.meta.env.VITE_API_URL ?? '';
const IS_DEV = !import.meta.env.VITE_SUPABASE_URL;

async function authHeader(): Promise<Record<string, string>> {
  if (IS_DEV) return { Authorization: 'Bearer dev-token' };
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(`${BASE}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      'ngrok-skip-browser-warning': 'true', // evita la interstitial de ngrok en las llamadas API
      ...auth,
      ...(init?.headers || {}),
    },
    ...init,
  });
  if (res.status === 401) {
    // No forzar logout cuando es /api/me (resolución de rol): un 401 ahí significa
    // "sin perfil", y desloguear crearía un loop login→/api/me→401→login.
    if (!IS_DEV && !path.startsWith('/api/me')) { await supabase.auth.signOut(); window.location.href = '/login'; }
    throw new Error('Sesión expirada');
  }
  if (res.status === 403) throw new Error('No tenés permiso para esta acción');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API ${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}

// ── Accounts ────────────────────────────────────────────────
import type { Account } from '../types';

export const accountsApi = {
  list: (userId: string) =>
    api<Account[]>(`/api/accounts?user_id=${encodeURIComponent(userId)}`),

  create: (
    userId: string,
    name: string,
    opts?: {
      channel?: 'whatsapp' | 'facebook' | 'instagram';
      provider?: 'baileys' | 'official';
      flow_id?: string | null;
      external_id?: string;
      access_token?: string;
      app_secret?: string;
      verify_token?: string;
    }
  ) =>
    api<Account>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, name, ...(opts || {}) }),
    }),

  update: (
    id: string,
    updates: {
      name?: string;
      phone_number?: string | null;
      channel?: 'whatsapp' | 'facebook' | 'instagram';
      provider?: 'baileys' | 'official';
      flow_id?: string | null;
      external_id?: string | null;
      access_token?: string | null;
      app_secret?: string | null;
      verify_token?: string | null;
      reminder_minutes?: number;
      ai_support_enabled?: boolean;
      ai_api_key?: string | null;
      ai_model?: string | null;
      ai_support_prompt?: string | null;
    }
  ) =>
    api<Account>(`/api/accounts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  connect: (id: string) =>
    api<{ status: string }>(`/api/accounts/${id}/connect`, { method: 'POST' }),

  disconnect: (id: string) =>
    api<{ status: string }>(`/api/accounts/${id}/disconnect`, { method: 'POST' }),

  qr: (id: string) =>
    api<{ qr: string | null; status: string }>(`/api/accounts/${id}/qr`),

  status: (id: string) =>
    api<{ status: string }>(`/api/accounts/${id}/status`),

  // Prueba el token de una línea Meta/oficial contra la Graph API en vivo.
  verifyMeta: (id: string) =>
    api<{ ok: boolean; status: string; reason?: string; info?: { verified_name?: string; display_phone_number?: string; name?: string } }>(
      `/api/accounts/${id}/verify-meta`, { method: 'POST' }),

  delete: (id: string) =>
    api<{ ok: boolean }>(`/api/accounts/${id}`, { method: 'DELETE' }),
};

// ── Flows ───────────────────────────────────────────────────
import type { Flow } from '../types';

export const flowsApi = {
  list: (accountId: string) =>
    api<Flow[]>(`/api/flows?account_id=${encodeURIComponent(accountId)}`),

  // Todos los flujos del usuario (across cuentas) — para verlos/editarlos en el bot builder.
  listByUser: (userId: string) =>
    api<Flow[]>(`/api/flows?user_id=${encodeURIComponent(userId)}`),

  get: (id: string) =>
    api<Flow>(`/api/flows/${id}`),

  create: (flow: Omit<Flow, 'id' | 'created_at'>) =>
    api<Flow>('/api/flows', { method: 'POST', body: JSON.stringify(flow) }),

  update: (id: string, flow: Partial<Flow>) =>
    api<Flow>(`/api/flows/${id}`, { method: 'PUT', body: JSON.stringify(flow) }),

  delete: (id: string) =>
    api<{ ok: boolean }>(`/api/flows/${id}`, { method: 'DELETE' }),
};

// ── Conversations & Messages ────────────────────────────────
import type { WhatsAppConversation, WhatsAppMessage } from '../types';

export const conversationsApi = {
  list: (accountId: string) =>
    api<WhatsAppConversation[]>(`/api/conversations?account_id=${encodeURIComponent(accountId)}`),

  // Bandeja unificada: todas las líneas del estudio en una sola query.
  listAll: () =>
    api<WhatsAppConversation[]>(`/api/conversations?account_id=all`),

  messages: (conversationId: string) =>
    api<WhatsAppMessage[]>(`/api/conversations/${conversationId}/messages`),

  handover: (conversationId: string, resume: boolean) =>
    api<{ status: string }>(`/api/conversations/${conversationId}/handover`, {
      method: 'POST',
      body: JSON.stringify({ resume }),
    }),
  reset: (conversationId: string) =>
    api<{ ok: boolean; reset_at: string }>(`/api/conversations/${conversationId}/reset`, {
      method: 'POST',
    }),
};

export const messagesApi = {
  send: (accountId: string, phone: string, text: string) =>
    api<{ ok: boolean; resolved?: boolean }>('/api/messages/send', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId, phone, text }),
    }),
};

// ── Llamadas (voz por API oficial de WhatsApp/Meta) ────────
export const callsApi = {
  voice: (accountId: string, phone: string) =>
    api<{ status: 'initiated' | 'not_configured' | 'error'; message?: string }>('/api/calls/voice', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId, phone }),
    }),
};

// ── Salas de videollamada (Daily) ──────────────────────────
export interface JoinResult { roomUrl: string; room: string; displayName: string; }
export const salasApi = {
  create: (body: { account_id?: string; appointment_id?: string; titulo?: string; created_by?: string }) =>
    api<{ id: string; daily_url: string; daily_room: string }>('/api/salas', { method: 'POST', body: JSON.stringify(body) }),
  invitar: (salaId: string, nombre: string) =>
    api<{ enlace: string; salaId: string; expiraEn: string }>(`/api/salas/${salaId}/invitar`, { method: 'POST', body: JSON.stringify({ nombre }) }),
  join: (salaId: string, invite: string) =>
    api<JoinResult>('/api/salas/join', { method: 'POST', body: JSON.stringify({ salaId, invite }) }),
  hostToken: (salaId: string, nombre?: string) =>
    api<JoinResult>(`/api/salas/${salaId}/host-token`, { method: 'POST', body: JSON.stringify({ nombre }) }),
};

// ── Appointments & Agenda ──────────────────────────────────
export interface Appointment {
  id: string;
  account_id: string;
  phone: string;
  nombre: string;
  telefono: string;
  resumen: string;
  status: 'pendiente' | 'confirmada' | 'cancelada' | 'asistio' | 'no_asistio' | 'cerrado';
  created_at: string;
  updated_at: string;
  start_time?: string;
  end_time?: string;
  oficina?: string; // modalidad/oficina (Videollamada, Presencial CABA…)
  assigned_profile_id?: string | null; // abogada/profesional

  // Ficha de recepción (migración 0023).
  motivo?: AppointmentMotivo | null;
  dni?: string | null;
  faltante?: string | null;
  canal_origen?: AppointmentCanal | null;
  canal_auto?: boolean;
  carpeta?: boolean;
  seguimiento?: string | null;
  resultado?: AppointmentResultado | null;
  atendido_por?: string | null; // empleada/recepcionista (profiles.id)
}

export type AppointmentMotivo =
  | 'jubilacion' | 'puam' | 'pension_v' | 'reajuste' | 'rti'
  | 'laboral' | 'pension_discapacidad' | 'asesoramiento_pago' | 'otro';

export type AppointmentCanal =
  | 'whatsapp' | 'facebook' | 'instagram' | 'tiktok'
  | 'google' | 'recomendada' | 'pagina_web' | 'otro';

export type AppointmentResultado = 'si' | 'no' | 'pensar' | 'traer_doc';

// Etiquetas para los <select> de la ficha de recepción.
export const MOTIVO_LABELS: Record<AppointmentMotivo, string> = {
  jubilacion: 'Jubilación', puam: 'PUAM', pension_v: 'Pensión por viudez',
  reajuste: 'Reajuste', rti: 'RTI', laboral: 'Laboral',
  pension_discapacidad: 'Pensión por discapacidad', asesoramiento_pago: 'Asesoramiento pago', otro: 'Otro',
};
export const CANAL_LABELS: Record<AppointmentCanal, string> = {
  whatsapp: 'WhatsApp', facebook: 'Facebook', instagram: 'Instagram', tiktok: 'TikTok',
  google: 'Google', recomendada: 'Recomendada', pagina_web: 'Página web', otro: 'Otro',
};
export const RESULTADO_LABELS: Record<AppointmentResultado, string> = {
  si: 'SÍ (cliente)', no: 'NO', pensar: 'PENSAR', traer_doc: 'Traer documentación',
};

export interface AuditField {
  campo: 'telefono' | 'nombre' | 'motivo' | 'fecha' | 'oficina';
  valor_cita: string | null;
  valor_chat: string | null;
  coincide: boolean;
  confianza: number;
  sugerencia: string | null;
  nota?: string;
  resuelto?: boolean;
}
export interface AuditResultDTO { revisar: boolean; campos: AuditField[]; sin_chat: boolean; error?: string }

export const appointmentsApi = {
  list: (accountId: string) =>
    api<Appointment[]>(`/api/appointments?account_id=${encodeURIComponent(accountId)}`),

  create: (appointment: Omit<Appointment, 'id' | 'created_at' | 'updated_at'>) =>
    api<Appointment>('/api/appointments', {
      method: 'POST',
      body: JSON.stringify(appointment),
    }),

  update: (id: string, updates: Partial<Appointment>) =>
    api<Appointment>(`/api/appointments/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updates),
    }),

  delete: (id: string) =>
    api<{ ok: boolean }>(`/api/appointments/${id}`, {
      method: 'DELETE',
    }),

  audit: (body: { account_id?: string; ids?: string[] }) =>
    api<{ audited: number; flagged: number; errored: number; truncated: boolean; results: Array<{ id: string } & AuditResultDTO> }>(
      '/api/appointments/audit',
      { method: 'POST', body: JSON.stringify(body) },
    ),

  applyAuditFix: (id: string, campo: string) =>
    api<Appointment>(`/api/appointments/${id}/audit/apply`, {
      method: 'POST', body: JSON.stringify({ campo }),
    }),
};

// ── Disponibilidad (modal de agendado manual desde el chat) ──
export interface AvailabilityOffice {
  id: string;
  nombre: string;
  modalidad: 'presencial' | 'video' | 'ambas';
  profesionales: Array<{ id: string; name: string }>;
}
export interface FreeSlot { start: string; end: string; }

export const availabilityApi = {
  offices: (accountId: string) =>
    api<AvailabilityOffice[]>(`/api/availability/offices?account_id=${encodeURIComponent(accountId)}`),

  slots: (accountId: string, oficina: string, opts: { profesional?: string | null; date?: string | null } = {}) => {
    const q = new URLSearchParams({ account_id: accountId, oficina });
    if (opts.profesional) q.set('profesional', opts.profesional);
    if (opts.date) q.set('date', opts.date);
    return api<FreeSlot[]>(`/api/availability/slots?${q.toString()}`);
  },
};

// ── Configuration & Environment ──────────────────────────────
export const configApi = {
  get: () =>
    api<Record<string, string>>('/api/config'),

  save: (configs: Record<string, string>) =>
    api<{ success: boolean; message: string }>('/api/config', {
      method: 'POST',
      body: JSON.stringify(configs),
    }),

  syncDb: (databaseUrl?: string) =>
    api<{ success: boolean; message: string }>('/api/config/sync-db', {
      method: 'POST',
      body: JSON.stringify({ DATABASE_URL: databaseUrl }),
    }),

  restart: () =>
    api<{ success: boolean; message: string }>('/api/config/restart', {
      method: 'POST',
    }),
};

// ── Auth / rol ───────────────────────────────────────────────
import type { Profile, Role } from '../types';

export const meApi = {
  get: () => api<{ id: string; role: Role; name: string | null }>('/api/me'),
};

export const teamApi = {
  list: () => api<Profile[]>('/api/team'),
  create: (email: string, password: string, name: string) =>
    api<Profile>('/api/team', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  setActive: (id: string, active: boolean) =>
    api<Profile>(`/api/team/${id}`, { method: 'PUT', body: JSON.stringify({ active }) }),
  rename: (id: string, name: string) =>
    api<Profile>(`/api/team/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  resetPassword: (id: string, password: string) =>
    api<{ ok: boolean }>(`/api/team/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
};

// ── Oficinas & Profesionales (Agenda) ───────────────────────
import type { Office, OfficeProfessional, AvailabilityWindow, ProfessionalBlock, ProfessionalLite } from '../types';

export const officesApi = {
  list: (accountId: string) =>
    api<Office[]>(`/api/offices?account_id=${encodeURIComponent(accountId)}`),
  create: (body: Partial<Office> & { account_id: string; nombre: string; modalidad: string; hora_inicio: string; hora_fin: string }) =>
    api<Office>('/api/offices', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, updates: Partial<Office>) =>
    api<Office>(`/api/offices/${id}`, { method: 'PUT', body: JSON.stringify(updates) }),
  remove: (id: string) =>
    api<{ ok: boolean }>(`/api/offices/${id}`, { method: 'DELETE' }),

  professionals: (officeId: string) =>
    api<OfficeProfessional[]>(`/api/offices/${officeId}/professionals`),
  assign: (officeId: string, profileId: string) =>
    api<OfficeProfessional>(`/api/offices/${officeId}/professionals`, { method: 'POST', body: JSON.stringify({ profile_id: profileId }) }),
  unassign: (officeId: string, profileId: string) =>
    api<{ ok: boolean }>(`/api/offices/${officeId}/professionals/${profileId}`, { method: 'DELETE' }),
};

export const professionalsApi = {
  list: () => api<ProfessionalLite[]>('/api/professionals'),
  getAvailability: (profileId: string, officeId: string) =>
    api<AvailabilityWindow[]>(`/api/professionals/${profileId}/availability?office_id=${encodeURIComponent(officeId)}`),
  setAvailability: (profileId: string, officeId: string, ventanas: AvailabilityWindow[]) =>
    api<AvailabilityWindow[]>(`/api/professionals/${profileId}/availability?office_id=${encodeURIComponent(officeId)}`,
      { method: 'PUT', body: JSON.stringify({ ventanas: ventanas.map(({ dia, hora_inicio, hora_fin }) => ({ dia, hora_inicio, hora_fin })) }) }),
  getBlocks: (profileId: string) =>
    api<ProfessionalBlock[]>(`/api/professionals/${profileId}/blocks`),
  addBlock: (profileId: string, body: { office_id?: string | null; start_time: string; end_time: string; motivo?: string | null }) =>
    api<ProfessionalBlock>(`/api/professionals/${profileId}/blocks`, { method: 'POST', body: JSON.stringify(body) }),
  removeBlock: (profileId: string, blockId: string) =>
    api<{ ok: boolean }>(`/api/professionals/${profileId}/blocks/${blockId}`, { method: 'DELETE' }),
};

export const agendaApi = {
  office: (officeId: string, from: string, to: string) =>
    api<{ profesionales: { profile_id: string; name: string }[]; appointments: Appointment[]; unassigned: Appointment[] }>(
      `/api/agenda/offices/${officeId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  professional: (profileId: string, accountId: string, from: string, to: string) =>
    api<{ appointments: Appointment[] }>(
      `/api/agenda/professionals/${profileId}?account_id=${encodeURIComponent(accountId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  assign: (appointmentId: string, profileId: string | null) =>
    api<Appointment>(`/api/agenda/appointments/${appointmentId}/assign`, { method: 'PATCH', body: JSON.stringify({ profile_id: profileId }) }),
};

// ── Analíticas de recepción (solo admin) ────────────────────
export interface IntakeBucket { bucket: string; total: number; conversion: number }
export interface IntakeRank { id: string; name: string; total: number; conversion: number }
export interface IntakeAnalytics {
  total: number;
  conversion: number;
  porResultado: Record<string, number>;
  porCanal: Record<string, number>;
  porMotivo: Record<string, number>;
  porMes: IntakeBucket[];
  porEmpleada: IntakeRank[];
  porAbogada: IntakeRank[];
}

export const analyticsApi = {
  intake: (params: { from?: string; to?: string; account_id?: string } = {}) => {
    const q = new URLSearchParams();
    if (params.from) q.set('from', params.from);
    if (params.to) q.set('to', params.to);
    if (params.account_id) q.set('account_id', params.account_id);
    const qs = q.toString();
    return api<IntakeAnalytics>(`/api/analytics/intake${qs ? `?${qs}` : ''}`);
  },
};

// ── Agente (cerebro editable, solo admin) ───────────────────
export type AgenteOficina = 'CABA' | 'Quilmes' | 'Haedo';
export type AgenteChange =
  | { type: 'set_tono'; texto: string }
  | { type: 'set_datos'; texto: string; modo: 'reemplazar' | 'agregar' }
  | { type: 'set_procedimientos'; texto: string; modo: 'reemplazar' | 'agregar' }
  | { type: 'add_faq'; pregunta: string; respuesta: string; tags?: string[] }
  | { type: 'edit_faq'; pregunta: string; nueva_respuesta?: string; nueva_pregunta?: string; tags?: string[] }
  | { type: 'remove_faq'; pregunta: string }
  | { type: 'add_zona'; localidad: string; oficina: AgenteOficina }
  | { type: 'remove_zona'; localidad: string };

export interface BrainState {
  tono: string | null;
  datos: string | null;
  procedimientos: string | null;
  faqs: Array<{ id: string; pregunta: string; respuesta: string; tags: string[] }>;
  zonas: Array<{ id: string; alias: string; oficina: string }>;
  lineas: number;
}

export const agenteApi = {
  state: () => api<BrainState>('/api/agente/state'),
  chat: (messages: Array<{ role: 'user' | 'assistant'; content: string }>) =>
    api<{ reply: string; pendingChanges: AgenteChange[] }>('/api/agente/chat', {
      method: 'POST', body: JSON.stringify({ messages }),
    }),
  apply: (changes: AgenteChange[]) =>
    api<{ applied: number; results: Array<{ change: AgenteChange; ok: boolean; error?: string }> }>(
      '/api/agente/apply', { method: 'POST', body: JSON.stringify({ changes }) }),
};

// Para mostrar URLs absolutas (ej webhook de Meta) mantenemos un base explícito.
export const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

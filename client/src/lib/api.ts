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

  messages: (conversationId: string) =>
    api<WhatsAppMessage[]>(`/api/conversations/${conversationId}/messages`),

  handover: (conversationId: string, resume: boolean) =>
    api<{ status: string }>(`/api/conversations/${conversationId}/handover`, {
      method: 'POST',
      body: JSON.stringify({ resume }),
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
}

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

// Para mostrar URLs absolutas (ej webhook de Meta) mantenemos un base explícito.
export const apiBase = import.meta.env.VITE_API_URL || 'http://localhost:3001';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
    ...init,
  });
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

  create: (userId: string, name: string) =>
    api<Account>('/api/accounts', {
      method: 'POST',
      body: JSON.stringify({ user_id: userId, name }),
    }),

  connect: (id: string) =>
    api<{ status: string }>(`/api/accounts/${id}/connect`, { method: 'POST' }),

  disconnect: (id: string) =>
    api<{ status: string }>(`/api/accounts/${id}/disconnect`, { method: 'POST' }),

  qr: (id: string) =>
    api<{ qr: string | null; status: string }>(`/api/accounts/${id}/qr`),

  status: (id: string) =>
    api<{ status: string }>(`/api/accounts/${id}/status`),
};

// ── Flows ───────────────────────────────────────────────────
import type { Flow } from '../types';

export const flowsApi = {
  list: (accountId: string) =>
    api<Flow[]>(`/api/flows?account_id=${encodeURIComponent(accountId)}`),

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
    api<{ ok: boolean }>('/api/messages/send', {
      method: 'POST',
      body: JSON.stringify({ account_id: accountId, phone, text }),
    }),
};

// ── Appointments & Agenda ──────────────────────────────────
export interface Appointment {
  id: string;
  account_id: string;
  phone: string;
  nombre: string;
  telefono: string;
  resumen: string;
  status: 'pendiente' | 'confirmada' | 'cancelada';
  created_at: string;
  updated_at: string;
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

export const apiBase = BASE;

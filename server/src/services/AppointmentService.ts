import { supabase } from '../config/supabase';
import crypto from 'crypto';

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
  reminded?: boolean; // recordatorio 20' antes ya enviado (idempotencia del scheduler)
  oficina?: string;   // modalidad/oficina: pool de disponibilidad independiente (Videollamada, CABA, Quilmes, Haedo…)
  assigned_profile_id?: string | null; // profesional asignado (Fase 2); null = legacy/pool
}

const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_KEY &&
  !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
  !process.env.SUPABASE_SERVICE_KEY.includes('...')
);

// In-memory appointments store as fallback
const memoryAppointments: Map<string, Appointment> = new Map();

// El "envelope" que empaquetamos en la columna `resumen` (la tabla no tiene columnas
// reales para start_time/etc). Solo lo tratamos como metadata si tiene la forma esperada,
// así una nota del usuario que casualmente sea JSON (ej '{"x":1}') NO se malinterpreta.
function isEnvelope(o: any): boolean {
  return !!o && typeof o === 'object' && !Array.isArray(o) &&
    ('text' in o || 'start_time' in o || 'oficina' in o || 'reminded' in o);
}

const plus30 = (iso: string) => new Date(new Date(iso).getTime() + 30 * 60000).toISOString();

function deserializeAppointment(app: any): Appointment {
  // 1) Esquema 0011: columnas reales pobladas.
  if (app.start_time) {
    return {
      ...app,
      resumen: app.resumen || '',
      start_time: app.start_time,
      end_time: app.end_time || plus30(app.start_time),
      reminded: !!app.reminded,
      oficina: app.oficina || '',
      assigned_profile_id: app.assigned_profile_id ?? null,
    };
  }
  // 2) Legacy (pre-0011): envelope JSON empaquetado en resumen.
  if (app.resumen && (app.resumen.startsWith('{') || app.resumen.startsWith('['))) {
    try {
      const parsed = JSON.parse(app.resumen);
      if (isEnvelope(parsed)) {
        return {
          ...app,
          resumen: parsed.text || '',
          start_time: parsed.start_time || app.created_at,
          end_time: parsed.end_time || plus30(app.created_at),
          reminded: !!parsed.reminded,
          oficina: parsed.oficina || '',
        };
      }
    } catch {
      // No es JSON válido → texto crudo (abajo).
    }
  }
  // 3) Texto crudo / cita sin horario.
  return {
    ...app,
    resumen: app.resumen || '',
    start_time: app.start_time || app.created_at,
    end_time: app.end_time || plus30(app.created_at),
    reminded: !!app.reminded,
    oficina: app.oficina || '',
    assigned_profile_id: app.assigned_profile_id ?? null,
  };
}

export const AppointmentService = {
  async getById(id: string): Promise<Appointment | null> {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data ? deserializeAppointment(data) : null;
    }
    const app = memoryAppointments.get(id);
    return app || null;
  },

  async list(accountId?: string): Promise<Appointment[]> {
    if (isSupabaseConfigured) {
      let query = supabase.from('appointments').select('*').order('created_at', { ascending: false });
      if (accountId) {
        query = query.eq('account_id', accountId);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return (data || []).map(deserializeAppointment);
    }

    const list = Array.from(memoryAppointments.values())
      .filter(a => !accountId || a.account_id === accountId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list;
  },

  // Citas en una ventana ±windowMs alrededor de ahora, excluyendo estados terminales.
  // Para el ReminderScheduler: evita el full-scan de toda la tabla cada minuto.
  async listSchedulerWindow(windowMs: number): Promise<Appointment[]> {
    const now = Date.now();
    const fromIso = new Date(now - windowMs).toISOString();
    const toIso = new Date(now + windowMs).toISOString();
    const TERMINAL = ['cancelada', 'asistio', 'no_asistio', 'cerrado'];

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .gte('start_time', fromIso)
        .lte('start_time', toIso)
        .not('status', 'in', `(${TERMINAL.join(',')})`);
      if (error) throw new Error(error.message);
      return (data || []).map(deserializeAppointment);
    }

    return Array.from(memoryAppointments.values()).filter(a => {
      if (!a.start_time) return false;
      const t = new Date(a.start_time).getTime();
      return t >= now - windowMs && t <= now + windowMs && !TERMINAL.includes(a.status);
    });
  },

  // ¿Hay una cita NO cancelada que solape el slot pedido en el mismo pool (oficina)?
  // Re-chequeo anti doble-booking: la disponibilidad se evaluó en otro nodo (TOCTOU);
  // revalidamos contra el estado actual justo antes de insertar.
  async hasOverlap(accountId: string, start?: string, end?: string, oficina?: string): Promise<boolean> {
    if (!start || !end) return false;
    const reqStart = new Date(start).getTime();
    const reqEnd = new Date(end).getTime();
    if (!Number.isFinite(reqStart) || !Number.isFinite(reqEnd)) return false;
    const existing = await this.list(accountId);
    const pool = (oficina || '').trim().toLowerCase();
    return existing.some(a =>
      a.status !== 'cancelada' && a.start_time && a.end_time &&
      (a.oficina || '').trim().toLowerCase() === pool &&
      new Date(a.start_time).getTime() < reqEnd &&
      new Date(a.end_time).getTime() > reqStart
    );
  },

  async create(appointment: Omit<Appointment, 'id' | 'created_at' | 'updated_at'>): Promise<Appointment> {
    if (await this.hasOverlap(appointment.account_id, appointment.start_time, appointment.end_time, appointment.oficina)) {
      throw new Error('SLOT_TAKEN');
    }

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('appointments')
        .insert({
          account_id: appointment.account_id,
          phone: appointment.phone,
          nombre: appointment.nombre,
          telefono: appointment.telefono,
          resumen: appointment.resumen || '',
          status: appointment.status || 'pendiente',
          start_time: appointment.start_time || null,
          end_time: appointment.end_time || null,
          reminded: !!appointment.reminded,
          oficina: appointment.oficina || null,
          assigned_profile_id: appointment.assigned_profile_id ?? null,
        })
        .select('*')
        .single();
      if (error) {
        // Constraint de exclusión (migración 0012) o trigger de capacidad (0017):
        // slot tomado por otra cita concurrente. Cierra la ventana TOCTOU del chequeo en app (hasOverlap).
        if (
          error.code === '23P01' ||
          (error.message || '').includes('appointments_no_overlap') ||
          (error.message || '').includes('office_capacity_full') ||
          (error.message || '').includes('professional_busy')
        ) {
          throw new Error('SLOT_TAKEN');
        }
        throw new Error(error.message);
      }
      return deserializeAppointment(data);
    }

    const id = crypto.randomUUID();
    const newApp: Appointment = {
      id,
      ...appointment,
      status: appointment.status || 'pendiente',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    memoryAppointments.set(id, newApp);
    console.log(`📝 [memory] Appointment booked: ${newApp.nombre} (${newApp.phone})`);
    return newApp;
  },

  async update(id: string, updates: Partial<Appointment>): Promise<Appointment> {
    const current = await this.getById(id);
    if (!current) throw new Error('Cita no encontrada');

    const merged = {
      ...current,
      ...updates
    };

    if (isSupabaseConfigured) {
      // account_id NO se actualiza (la cita no se mueve de cuenta). updated_at existe desde 0011.
      const { data, error } = await supabase
        .from('appointments')
        .update({
          phone: merged.phone,
          nombre: merged.nombre,
          telefono: merged.telefono,
          resumen: merged.resumen || '',
          status: merged.status,
          start_time: merged.start_time || null,
          end_time: merged.end_time || null,
          reminded: !!merged.reminded,
          oficina: merged.oficina || null,
          assigned_profile_id: merged.assigned_profile_id ?? null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', id)
        .select('*')
        .single();
      if (error) {
        // Reasignación a un profesional ya ocupado (trigger 0021): error específico.
        if ((error.message || '').includes('professional_busy')) {
          throw new Error('PROFESSIONAL_BUSY');
        }
        // Trigger de capacidad (0017) o constraint (0012): slot tomado.
        if (
          error.code === '23P01' ||
          (error.message || '').includes('appointments_no_overlap') ||
          (error.message || '').includes('office_capacity_full')
        ) {
          throw new Error('SLOT_TAKEN');
        }
        throw new Error(error.message);
      }
      return deserializeAppointment(data);
    }

    const updated = {
      ...merged,
      updated_at: new Date().toISOString(),
    };
    memoryAppointments.set(id, updated);
    console.log(`📝 [memory] Appointment updated: ${updated.id} status=${updated.status}`);
    return updated;
  },

  async delete(id: string): Promise<boolean> {
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('appointments').delete().eq('id', id);
      if (error) throw new Error(error.message);
      return true;
    }

    if (!memoryAppointments.has(id)) throw new Error('Cita no encontrada');
    memoryAppointments.delete(id);
    console.log(`🗑️ [memory] Appointment deleted: ${id}`);
    return true;
  }
};

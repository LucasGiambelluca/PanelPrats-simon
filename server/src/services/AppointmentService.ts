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
}

const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_KEY &&
  !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
  !process.env.SUPABASE_SERVICE_KEY.includes('...')
);

// In-memory appointments store as fallback
const memoryAppointments: Map<string, Appointment> = new Map();

function deserializeAppointment(app: any): Appointment {
  try {
    if (app.resumen && (app.resumen.startsWith('{') || app.resumen.startsWith('['))) {
      const parsed = JSON.parse(app.resumen);
      return {
        ...app,
        resumen: parsed.text || '',
        start_time: parsed.start_time || app.created_at,
        end_time: parsed.end_time || new Date(new Date(app.created_at).getTime() + 30 * 60000).toISOString(),
        reminded: !!parsed.reminded,
        oficina: parsed.oficina || '',
      };
    }
  } catch (e) {
    // If JSON parsing fails, treat it as raw text
  }
  return {
    ...app,
    start_time: app.created_at,
    end_time: new Date(new Date(app.created_at).getTime() + 30 * 60000).toISOString(),
    reminded: false,
  };
}

function serializeAppointment(appointment: Omit<Appointment, 'id' | 'created_at' | 'updated_at'>): any {
  // reminded se destructura fuera de `rest` porque NO es columna real: va dentro del JSON.
  const { start_time, end_time, resumen, reminded, oficina, ...rest } = appointment;
  const packedResumen = JSON.stringify({
    text: resumen || '',
    start_time: start_time || null,
    end_time: end_time || null,
    reminded: !!reminded,
    oficina: oficina || '',
  });
  return {
    ...rest,
    resumen: packedResumen,
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

  async create(appointment: Omit<Appointment, 'id' | 'created_at' | 'updated_at'>): Promise<Appointment> {
    const serialized = serializeAppointment(appointment);

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('appointments')
        .insert({ ...serialized, status: appointment.status || 'pendiente' })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
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

    const serialized = serializeAppointment({
      account_id: merged.account_id,
      phone: merged.phone,
      nombre: merged.nombre,
      telefono: merged.telefono,
      resumen: merged.resumen,
      status: merged.status,
      start_time: merged.start_time,
      end_time: merged.end_time,
      reminded: merged.reminded,
      oficina: merged.oficina,
    });

    if (isSupabaseConfigured) {
      // NB: la tabla appointments (migración 0002) no tiene columna updated_at,
      // por eso NO la escribimos (escribirla daría PGRST204 y rompería confirmar/cancelar).
      const { data, error } = await supabase
        .from('appointments')
        .update(serialized)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
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

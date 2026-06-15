import { supabase } from '../config/supabase';
import crypto from 'crypto';

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

const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_KEY &&
  !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
  !process.env.SUPABASE_SERVICE_KEY.includes('...')
);

// In-memory appointments store as fallback
const memoryAppointments: Map<string, Appointment> = new Map();

export const AppointmentService = {
  async list(accountId?: string): Promise<Appointment[]> {
    if (isSupabaseConfigured) {
      let query = supabase.from('appointments').select('*').order('created_at', { ascending: false });
      if (accountId) {
        query = query.eq('account_id', accountId);
      }
      const { data, error } = await query;
      if (error) throw new Error(error.message);
      return data || [];
    }

    const list = Array.from(memoryAppointments.values())
      .filter(a => !accountId || a.account_id === accountId)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return list;
  },

  async create(appointment: Omit<Appointment, 'id' | 'created_at' | 'updated_at'>): Promise<Appointment> {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('appointments')
        .insert({ ...appointment, status: appointment.status || 'pendiente' })
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data;
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
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('appointments')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw new Error(error.message);
      return data;
    }

    const existing = memoryAppointments.get(id);
    if (!existing) throw new Error('Cita no encontrada');
    const updated = {
      ...existing,
      ...updates,
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

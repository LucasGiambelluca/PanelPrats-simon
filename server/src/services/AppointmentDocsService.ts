import { supabase } from '../config/supabase';

export interface AppointmentDoc {
  id: string;
  appointment_id: string;
  account_id: string;
  documento: string;
  estado: 'pendiente' | 'entregado';
  requested_at: string;
  delivered_at: string | null;
  created_at: string;
}

export const AppointmentDocsService = {
  async list(appointmentId: string): Promise<AppointmentDoc[]> {
    const { data, error } = await supabase
      .from('appointment_docs').select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as AppointmentDoc[];
  },

  async add(appointmentId: string, accountId: string, documento: string): Promise<AppointmentDoc> {
    const { data, error } = await supabase
      .from('appointment_docs')
      .insert({ appointment_id: appointmentId, account_id: accountId, documento })
      .select('*').single();
    if (error) throw new Error(error.message);
    return data as AppointmentDoc;
  },

  async setEstado(id: string, estado: 'pendiente' | 'entregado'): Promise<void> {
    const patch = estado === 'entregado'
      ? { estado, delivered_at: new Date().toISOString() }
      : { estado, delivered_at: null };
    const { error } = await supabase.from('appointment_docs').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('appointment_docs').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  /** Mapa appointment_id → lista de nombres de docs PENDIENTES, para las citas dadas. */
  async pendingByAppointmentIds(ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (ids.length === 0) return out;
    const { data, error } = await supabase
      .from('appointment_docs').select('appointment_id, documento')
      .in('appointment_id', ids).eq('estado', 'pendiente');
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const arr = out.get((r as any).appointment_id) ?? [];
      arr.push((r as any).documento);
      out.set((r as any).appointment_id, arr);
    }
    return out;
  },
};

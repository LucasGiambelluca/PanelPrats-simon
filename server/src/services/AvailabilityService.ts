import { supabase } from '../config/supabase';
import { AppointmentService } from './AppointmentService';

export interface Office {
  id: string; account_id: string; nombre: string; modalidad: 'presencial' | 'video';
  direccion?: string | null; video_link?: string | null; dias: number[];
  hora_inicio: string; hora_fin: string; slot_min: number; capacidad: number;
  buffer_min: number; activa: boolean; orden: number;
}
export interface Slot { start: string; end: string; }

const norm = (s: string) => (s || '').trim().toLowerCase();
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && aEnd > bStart;

export class AvailabilityService {
  async listOffices(accountId: string): Promise<Office[]> {
    const { data } = await supabase.from('account_offices')
      .select('*').eq('account_id', accountId).order('orden', { ascending: true });
    return ((data ?? []) as Office[]).filter((o) => o.activa);
  }

  async getOffice(accountId: string, nombre: string): Promise<Office | null> {
    const list = await this.listOffices(accountId);
    return list.find((o) => norm(o.nombre) === norm(nombre)) ?? null;
  }

  /** Cuenta citas activas de esa oficina que solapan [start,end). */
  private async countOverlap(accountId: string, nombre: string, start: string, end: string): Promise<number> {
    const reqS = new Date(start).getTime(), reqE = new Date(end).getTime();
    const appts = await AppointmentService.list(accountId);
    return appts.filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.end_time &&
      norm(a.oficina || '') === norm(nombre) &&
      overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), reqS, reqE),
    ).length;
  }

  async hasCapacity(accountId: string, nombre: string, start: string, end: string): Promise<boolean> {
    const office = await this.getOffice(accountId, nombre);
    const cap = office?.capacidad ?? 1; // no configurada → 1 (comportamiento viejo)
    const ocupadas = await this.countOverlap(accountId, nombre, start, end);
    return ocupadas < cap;
  }
}

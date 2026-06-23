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

const TZ = 'America/Argentina/Buenos_Aires';
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// Interpreta una fecha en hora local del estudio → { dia: 0-6, hhmm: 'HH:MM' }.
function localParts(d: Date): { dia: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const wd = parts.find((p) => p.type === 'weekday')!.value;
  let hh = parts.find((p) => p.type === 'hour')!.value;
  const mm = parts.find((p) => p.type === 'minute')!.value;
  if (hh === '24') hh = '00';
  return { dia: WD[wd], hhmm: `${hh}:${mm}` };
}

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

  /** Cuenta citas solapantes de la oficina con assigned_profile_id null (legacy). */
  private async countLegacyOverlap(accountId: string, nombre: string, start: string, end: string): Promise<number> {
    const reqS = new Date(start).getTime(), reqE = new Date(end).getTime();
    const appts = await AppointmentService.list(accountId);
    return appts.filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.end_time &&
      !a.assigned_profile_id &&
      norm(a.oficina || '') === norm(nombre) &&
      overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), reqS, reqE),
    ).length;
  }

  async hasCapacity(accountId: string, nombre: string, start: string, end: string): Promise<boolean> {
    const office = await this.getOffice(accountId, nombre);
    if (!office) {
      // Oficina no configurada → capacidad 1 (comportamiento viejo).
      return (await this.countOverlap(accountId, nombre, start, end)) < 1;
    }
    const profIds = await this.officeProfIds(office.id);
    if (profIds.length === 0) {
      const cap = office.capacidad ?? 1;
      return (await this.countOverlap(accountId, nombre, start, end)) < cap;
    }
    const disponibles = (await this.availableProfessionals(office, start, end)).length;
    const legacy = await this.countLegacyOverlap(accountId, nombre, start, end);
    return disponibles - legacy > 0;
  }

  async freeSlots(accountId: string, nombre: string, opts: { desde?: string; hasta?: string; max?: number; now?: Date } = {}): Promise<Slot[]> {
    const office = await this.getOffice(accountId, nombre);
    if (!office) return [];
    const max = opts.max ?? 3;
    const now = opts.now ?? new Date();
    const minStart = new Date(now.getTime() + (office.buffer_min ?? 0) * 60000);

    const [sh, sm] = office.hora_inicio.split(':').map(Number);
    const [eh, em] = office.hora_fin.split(':').map(Number);
    const slotMs = office.slot_min * 60000;

    const out: Slot[] = [];
    for (let dayOffset = 0; dayOffset < 14 && out.length < max; dayOffset++) {
      const day = new Date(now.getTime() + dayOffset * 86400000);
      const { dia } = localParts(day);
      if (!office.dias.includes(dia)) continue;
      const workStart = new Date(day); workStart.setHours(sh || 9, sm || 0, 0, 0);
      const workEnd = new Date(day); workEnd.setHours(eh || 18, em || 0, 0, 0);

      for (let t = new Date(workStart); t.getTime() + slotMs <= workEnd.getTime() && out.length < max; t = new Date(t.getTime() + slotMs)) {
        const s = t.getTime(), e = s + slotMs;
        if (s < minStart.getTime()) continue;
        const startIso = new Date(s).toISOString(), endIso = new Date(e).toISOString();
        if (!(await this.hasCapacity(accountId, office.nombre, startIso, endIso))) continue;
        out.push({ start: startIso, end: endIso });
      }
    }
    return out;
  }

  /** profile_ids de profes ACTIVOS asignados a la oficina. */
  private async officeProfIds(officeId: string): Promise<string[]> {
    const { data } = await supabase.from('office_professionals')
      .select('profile_id, activa, office_id').eq('office_id', officeId);
    return ((data ?? []) as any[]).filter((r) => r.activa).map((r) => r.profile_id);
  }

  private async windowsForOffice(officeId: string): Promise<Array<{ profile_id: string; dia: number; hora_inicio: string; hora_fin: string }>> {
    const { data } = await supabase.from('professional_availability')
      .select('profile_id, office_id, dia, hora_inicio, hora_fin').eq('office_id', officeId);
    return (data ?? []) as any[];
  }

  private async blocksForOffice(officeId: string): Promise<Array<{ profile_id: string; office_id: string | null; start_time: string; end_time: string }>> {
    // Trae todos los bloqueos; se filtra en memoria por office_id null | officeId.
    const { data } = await supabase.from('professional_blocks')
      .select('profile_id, office_id, start_time, end_time');
    return (data ?? []) as any[];
  }

  async officeHasProfessionals(office: Office): Promise<boolean> {
    return (await this.officeProfIds(office.id)).length > 0;
  }

  /** profile_ids que pueden tomar el slot [start,end): ventana cubre + sin bloqueo + no asignados. */
  async availableProfessionals(office: Office, start: string, end: string): Promise<string[]> {
    const profIds = await this.officeProfIds(office.id);
    if (profIds.length === 0) return [];

    const { dia, hhmm: startHHMM } = localParts(new Date(start));
    const { hhmm: endHHMM } = localParts(new Date(end));
    const windows = await this.windowsForOffice(office.id);
    const withWindow = profIds.filter((pid) =>
      windows.some((w) => w.profile_id === pid && w.dia === dia &&
        w.hora_inicio <= startHHMM && w.hora_fin >= endHHMM));
    if (withWindow.length === 0) return [];

    const s = new Date(start).getTime(), e = new Date(end).getTime();
    const blocks = await this.blocksForOffice(office.id);
    const notBlocked = withWindow.filter((pid) =>
      !blocks.some((b) => b.profile_id === pid &&
        (b.office_id === null || b.office_id === office.id) &&
        new Date(b.start_time).getTime() < e && new Date(b.end_time).getTime() > s));
    if (notBlocked.length === 0) return [];

    const appts = (await AppointmentService.list(office.account_id)).filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.end_time &&
      norm(a.oficina || '') === norm(office.nombre) &&
      overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), s, e));
    const busy = new Set(appts.map((a: any) => a.assigned_profile_id).filter(Boolean));
    return notBlocked.filter((pid) => !busy.has(pid));
  }
}

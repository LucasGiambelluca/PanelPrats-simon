import { supabase } from '../config/supabase';
import { AppointmentService } from './AppointmentService';
import { isHolidayAR } from '../core/agent/context/holidays';

export interface Office {
  id: string; account_id: string; nombre: string; modalidad: 'presencial' | 'video' | 'ambas';
  direccion?: string | null; video_link?: string | null; dias: number[];
  hora_inicio: string; hora_fin: string; slot_min: number; capacidad: number;
  buffer_min: number; activa: boolean; orden: number;
}
export interface Slot { start: string; end: string; }

// Contexto de una oficina cargado UNA vez (profes/ventanas/bloqueos/citas) para
// evaluar capacidad de muchos slots en memoria, sin N+1 de round-trips a la DB.
interface OfficeCtx {
  profIds: string[];
  windows: Array<{ profile_id: string; dia: number; hora_inicio: string; hora_fin: string }>;
  blocks: Array<{ profile_id: string; office_id: string | null; start_time: string; end_time: string }>;
  appts: any[];
}

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

// Minutos que el huso del estudio está adelantado respecto de UTC en ese instante
// (negativo para Argentina, -180). Robusto ante cambios de offset.
function studioOffsetMinutes(d: Date): number {
  const p = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => Number(p.find((x) => x.type === t)!.value);
  let hh = get('hour'); if (hh === 24) hh = 0;
  const asUTC = Date.UTC(get('year'), get('month') - 1, get('day'), hh, get('minute'));
  return Math.round((asUTC - d.getTime()) / 60000);
}

// Instante UTC para la fecha-calendario local del estudio de `day`, a las HH:MM locales.
function studioDateAt(day: Date, hh: number, mm: number): Date {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(day); // 'YYYY-MM-DD'
  const [y, m, d] = ymd.split('-').map(Number);
  const probe = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const offMin = studioOffsetMinutes(probe);
  return new Date(Date.UTC(y, m - 1, d, hh, mm) - offMin * 60000);
}

export class AvailabilityService {
  // ORG-WIDE: las agendas (y sus turnos) son del estudio, compartidas por todos los
  // canales (WhatsApp/FB/IG). No filtramos por account_id: un booking de cualquier
  // canal ve las mismas agendas y respeta los turnos ya tomados en otros canales.
  async listOffices(_accountId?: string): Promise<Office[]> {
    const { data } = await supabase.from('account_offices')
      .select('*').order('orden', { ascending: true });
    return ((data ?? []) as Office[]).filter((o) => o.activa);
  }

  async getOffice(accountId: string, nombre: string): Promise<Office | null> {
    const list = await this.listOffices(accountId);
    return list.find((o) => norm(o.nombre) === norm(nombre)) ?? null;
  }

  /** Cuenta citas activas de la oficina que solapan [start,end). Puro (sobre `appts` ya cargadas). */
  private countOverlapPure(appts: any[], nombre: string, start: string, end: string): number {
    const reqS = new Date(start).getTime(), reqE = new Date(end).getTime();
    return appts.filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.end_time &&
      norm(a.oficina || '') === norm(nombre) &&
      overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), reqS, reqE),
    ).length;
  }

  /** Igual que countOverlapPure pero sólo citas legacy (sin assigned_profile_id). */
  private countLegacyOverlapPure(appts: any[], nombre: string, start: string, end: string): number {
    const reqS = new Date(start).getTime(), reqE = new Date(end).getTime();
    return appts.filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.end_time && !a.assigned_profile_id &&
      norm(a.oficina || '') === norm(nombre) &&
      overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), reqS, reqE),
    ).length;
  }

  /** Carga (en paralelo, UNA vez) todo lo necesario para evaluar capacidad de una oficina. */
  private async loadOfficeCtx(office: Office): Promise<OfficeCtx> {
    const [profIds, windows, blocks, appts] = await Promise.all([
      this.officeProfIds(office.id),
      this.windowsForOffice(office.id),
      this.blocksForOffice(office.id),
      AppointmentService.list(),
    ]);
    return { profIds, windows, blocks, appts };
  }

  /** profile_ids disponibles para [start,end) — puro, sobre un contexto ya cargado. */
  private availableProfsPure(ctx: OfficeCtx, office: Office, start: string, end: string): string[] {
    if (ctx.profIds.length === 0) return [];
    const { dia, hhmm: startHHMM } = localParts(new Date(start));
    const { hhmm: endHHMM } = localParts(new Date(end));
    const withWindow = ctx.profIds.filter((pid) => {
      const myWindows = ctx.windows.filter((w) => w.profile_id === pid);
      // Sin ventanas propias → disponibilidad = horario de la oficina (agenda 1-profesional).
      if (myWindows.length === 0) {
        return office.dias.includes(dia) && office.hora_inicio <= startHHMM && office.hora_fin >= endHHMM;
      }
      return myWindows.some((w) => w.dia === dia && w.hora_inicio <= startHHMM && w.hora_fin >= endHHMM);
    });
    if (withWindow.length === 0) return [];
    const s = new Date(start).getTime(), e = new Date(end).getTime();
    const notBlocked = withWindow.filter((pid) =>
      !ctx.blocks.some((b) => b.profile_id === pid &&
        (b.office_id === null || b.office_id === office.id) &&
        new Date(b.start_time).getTime() < e && new Date(b.end_time).getTime() > s));
    if (notBlocked.length === 0) return [];
    const busy = new Set(ctx.appts.filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.end_time &&
      norm(a.oficina || '') === norm(office.nombre) &&
      overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), s, e))
      .map((a: any) => a.assigned_profile_id).filter(Boolean));
    return notBlocked.filter((pid) => !busy.has(pid));
  }

  /** ¿Queda cupo en [start,end)? — puro, sobre un contexto ya cargado. */
  private hasCapacityPure(ctx: OfficeCtx, office: Office, start: string, end: string): boolean {
    if (ctx.profIds.length === 0) {
      const cap = office.capacidad ?? 1;
      return this.countOverlapPure(ctx.appts, office.nombre, start, end) < cap;
    }
    const disponibles = this.availableProfsPure(ctx, office, start, end).length;
    const legacy = this.countLegacyOverlapPure(ctx.appts, office.nombre, start, end);
    return disponibles - legacy > 0;
  }

  async hasCapacity(accountId: string, nombre: string, start: string, end: string): Promise<boolean> {
    const office = await this.getOffice(accountId, nombre);
    if (!office) {
      // Oficina no configurada → capacidad 1 (comportamiento viejo).
      const appts = await AppointmentService.list();
      return this.countOverlapPure(appts, nombre, start, end) < 1;
    }
    const ctx = await this.loadOfficeCtx(office);
    return this.hasCapacityPure(ctx, office, start, end);
  }

  async freeSlots(accountId: string, nombre: string, opts: { desde?: string; hasta?: string; max?: number; now?: Date; professionalId?: string } = {}): Promise<Slot[]> {
    const office = await this.getOffice(accountId, nombre);
    if (!office) return [];
    // Contexto de la oficina UNA sola vez (no por slot) → elimina el N+1 de round-trips.
    const ctx = await this.loadOfficeCtx(office);
    const max = opts.max ?? 3;
    const realNow = opts.now ?? new Date();
    // Ventana opcional [desde, hasta] (ej. un día concreto desde el selector de fecha).
    // El scan arranca en `desde` si vino; minStart nunca cae en el pasado real.
    const base = opts.desde ? new Date(opts.desde) : realNow;
    const minStart = new Date(Math.max(realNow.getTime(), base.getTime()) + (office.buffer_min ?? 0) * 60000);
    const hasta = opts.hasta ? new Date(opts.hasta).getTime() : Infinity;

    const [sh, sm] = office.hora_inicio.split(':').map(Number);
    const [eh, em] = office.hora_fin.split(':').map(Number);
    const slotMs = office.slot_min * 60000;

    const out: Slot[] = [];
    for (let dayOffset = 0; dayOffset < 14 && out.length < max; dayOffset++) {
      const day = new Date(base.getTime() + dayOffset * 86400000);
      const { dia } = localParts(day);
      if (!office.dias.includes(dia)) continue;
      // Excluir feriados nacionales AR: la fecha-calendario LOCAL del estudio de `day`.
      const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(day);
      if (isHolidayAR(ymd)) continue;
      const workStart = studioDateAt(day, sh || 9, sm || 0);
      const workEnd = studioDateAt(day, eh || 18, em || 0);
      if (workStart.getTime() > hasta) break; // pasado el fin de ventana → no seguir días

      for (let t = new Date(workStart); t.getTime() + slotMs <= workEnd.getTime() && out.length < max; t = new Date(t.getTime() + slotMs)) {
        const s = t.getTime(), e = s + slotMs;
        if (s < minStart.getTime()) continue;
        if (s >= hasta) break;
        const startIso = new Date(s).toISOString(), endIso = new Date(e).toISOString();
        // Filtro por profesional concreto, o cupo general — ambos en memoria sobre `ctx`.
        const ok = opts.professionalId
          ? this.availableProfsPure(ctx, office, startIso, endIso).includes(opts.professionalId)
          : this.hasCapacityPure(ctx, office, startIso, endIso);
        if (!ok) continue;
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
    const ctx = await this.loadOfficeCtx(office);
    return this.availableProfsPure(ctx, office, start, end);
  }

  /** Elige el profesional libre con menos turnos ese día (local). Desempate por nombre. */
  async pickProfessional(office: Office, start: string, end: string): Promise<string | null> {
    const cand = await this.availableProfessionals(office, start, end);
    if (cand.length === 0) return null;

    const targetDay = localParts(new Date(start)).dia;
    const appts = (await AppointmentService.list()).filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.assigned_profile_id &&
      localParts(new Date(a.start_time)).dia === targetDay);
    const load = new Map<string, number>();
    for (const pid of cand) load.set(pid, 0);
    for (const a of appts as any[]) if (load.has(a.assigned_profile_id)) load.set(a.assigned_profile_id, load.get(a.assigned_profile_id)! + 1);

    const { data } = await supabase.from('profiles').select('id, name');
    const nameOf = new Map(((data ?? []) as any[]).map((p) => [p.id, p.name ?? '']));

    return cand.slice().sort((a, b) => {
      const d = (load.get(a) ?? 0) - (load.get(b) ?? 0);
      if (d !== 0) return d;
      return String(nameOf.get(a) ?? '').localeCompare(String(nameOf.get(b) ?? ''));
    })[0];
  }

  /**
   * MOTOR de asignación: propone horarios en CASCADA por prioridad (`orden`),
   * filtrando por modalidad (video/presencial) y, en presencial, por zona.
   * Respeta inmediatez (mínimo `minLeadMin` minutos hacia adelante, default 60).
   * Llena la agenda de mayor prioridad primero; si no alcanza, baja a la siguiente.
   * Cada slot vuelve etiquetado con `oficina` + `profileId` (la chica de esa agenda).
   */
  async proposeCascade(
    accountId: string,
    opts: { modalidad: 'presencial' | 'video'; zona?: string; minLeadMin?: number; max?: number; now?: Date },
  ): Promise<Array<Slot & { oficina: string; profileId: string | null }>> {
    const now = opts.now ?? new Date();
    const leadNow = new Date(now.getTime() + (opts.minLeadMin ?? 60) * 60000);
    const max = opts.max ?? 3;

    let offices = await this.listOffices(accountId); // activas, ordenadas por `orden`
    // Filtrar por modalidad que la agenda acepta ('ambas' acepta las dos).
    offices = offices.filter((o) =>
      opts.modalidad === 'presencial'
        ? o.modalidad === 'presencial' || o.modalidad === 'ambas'
        : o.modalidad === 'video' || o.modalidad === 'ambas');
    // Presencial + zona: priorizar agendas cuya zona coincide (nombre o dirección).
    if (opts.modalidad === 'presencial' && opts.zona) {
      const z = norm(opts.zona);
      const byZona = offices.filter((o) => norm(o.nombre).includes(z) || norm(o.direccion || '').includes(z));
      if (byZona.length) offices = byZona;
    }

    const out: Array<Slot & { oficina: string; profileId: string | null }> = [];
    for (const o of offices) {
      if (out.length >= max) break;
      const slots = await this.freeSlots(accountId, o.nombre, { max: max - out.length, now: leadNow });
      for (const s of slots) {
        if (out.length >= max) break;
        const profileId = await this.pickProfessional(o, s.start, s.end);
        out.push({ ...s, oficina: o.nombre, profileId });
      }
    }
    return out;
  }
}

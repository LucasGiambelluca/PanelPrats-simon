// Lógica PURA del scheduler de proactivos: decide qué eventos temporales están
// vencidos para una cita. Sin DB, sin red, sin reloj (now se pasa por parámetro).
export type FollowupEvent = 'reminder_24h' | 'followup';

export interface SchedulerAppt {
  status: string;
  start_time?: string | null;
  reminder_24h_sent?: boolean;
  followup_sent?: boolean;
}
export interface SchedulerCfg {
  reminder24hEnabled: boolean;
  followupEnabled: boolean;
}

const H24 = 24 * 60 * 60 * 1000;

export function dueAppointmentEvents(a: SchedulerAppt, now: number, cfg: SchedulerCfg): FollowupEvent[] {
  const out: FollowupEvent[] = [];
  if (a.status === 'cancelada' || !a.start_time) return out;
  const startMs = new Date(a.start_time).getTime();
  if (!Number.isFinite(startMs)) return out;

  const msUntil = startMs - now;
  // Recordatorio 24h antes: dispara una vez cuando faltan ≤24h y la cita no empezó.
  if (cfg.reminder24hEnabled && !a.reminder_24h_sent && msUntil > 0 && msUntil <= H24) {
    out.push('reminder_24h');
  }
  // Seguimiento: dispara una vez cuando pasaron ≥24h del inicio del turno.
  if (cfg.followupEnabled && !a.followup_sent && (now - startMs) >= H24) {
    out.push('followup');
  }
  return out;
}

const AR_TZ = 'America/Argentina/Buenos_Aires';

/** Hora HH:mm (24h) del ISO en zona Argentina. */
export function horaAR(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: AR_TZ,
  });
}

/** Fecha "díaSemana d/m" del ISO en zona Argentina (ej "miércoles 8/7"). */
export function fechaAR(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('es-AR', { weekday: 'long', timeZone: AR_TZ });
  const dm = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: AR_TZ });
  return `${dia} ${dm}`;
}

export interface DocChaseCfg {
  docChaseEnabled: boolean;
  everyDays: number;
  max: number;
}
export interface ChaseAppt {
  status: string;
  followup_sent?: boolean;
  doc_chase_count?: number;
  doc_chase_last_at?: string | null;
}

/**
 * ¿Toca mandar un recordatorio de documentación pendiente?
 * El chase arranca DESPUÉS del follow-up (que ya mandó el primer pedido de docs),
 * respeta la cadencia (everyDays desde el último chase) y un máximo de intentos.
 */
export function docChaseDue(a: ChaseAppt, pendingCount: number, now: number, cfg: DocChaseCfg): boolean {
  if (!cfg.docChaseEnabled) return false;
  if (a.status === 'cancelada') return false;
  if (!a.followup_sent) return false;
  if (pendingCount <= 0) return false;
  if ((a.doc_chase_count ?? 0) >= cfg.max) return false;
  const lastMs = a.doc_chase_last_at ? new Date(a.doc_chase_last_at).getTime() : 0;
  return (now - lastMs) >= cfg.everyDays * 24 * 60 * 60 * 1000;
}

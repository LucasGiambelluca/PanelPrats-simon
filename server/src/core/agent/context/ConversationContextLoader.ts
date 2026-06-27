// ─── ConversationContextLoader (Capacidad 1) ──────────────────────────────────
// Loader único que corre SIEMPRE, antes de que cualquier motor actúe, y arma el
// ConversationContext que se inyecta al prompt. Da "memoria de empleado":
//  - reconoce al contacto que vuelve (no menú frío),
//  - retoma el hilo abierto,
//  - rehidrata desde Supabase si el historial de Redis venció,
//  - nunca rompe: si todo falla, degrada al comportamiento actual (contexto vacío).
//
// No habla con la DB directo: recibe sus fuentes por inyección (testeable + aislado).

import type { OfferedOption } from './OptionResolver';

const DAY = 86400000;
const RETURNING_WINDOW_DAYS = 7;
const TZ = 'America/Argentina/Buenos_Aires';

export interface OpenAppointment {
  id: string;
  start_time?: string;
  oficina?: string;
  status?: string;
  fechaTexto?: string; // formateada para el prompt
}

export interface ConversationContext {
  contact: Record<string, any>;
  longTermSummary: string | null;
  openAppointment: OpenAppointment | null;
  lastTopic: string | null;
  lastInteractionAt: Date | null;
  recentHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  lastOfferedOptions: OfferedOption[];
  isReturning: boolean; // hubo interacción previa reciente (< RETURNING_WINDOW_DAYS)
  isKnown: boolean;     // tenemos algún dato/memoria del contacto
}

export interface ContextLoaderDeps {
  loadMemory: (accountId: string, phone: string) => Promise<{
    profile: Record<string, any>; preferences: Record<string, any>; summary: string | null;
    lastInteractionAt: Date | null; lastTopic: string | null; currentThread: any;
  }>;
  history: (accountId: string, phone: string) => Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  nextAppointment: (accountId: string, phone: string) => Promise<OpenAppointment | null>;
  offeredOptions: (accountId: string, phone: string) => Promise<OfferedOption[]>;
  now?: () => Date;
}

/** ¿Es un contacto conocido que volvió hace poco? (gatilla saludo de continuidad). */
export function isReturning(
  input: { lastInteractionAt: Date | null; isKnown: boolean },
  now: Date,
): boolean {
  if (!input.isKnown || !input.lastInteractionAt) return false;
  return now.getTime() - input.lastInteractionAt.getTime() <= RETURNING_WINDOW_DAYS * DAY;
}

function fmtFecha(iso?: string): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleString('es-AR', {
      weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
      hour12: false, timeZone: TZ,
    });
  } catch { return null; }
}

/** Bloque de continuidad para el system prompt. Vacío si el contacto es nuevo. */
export function buildContinuityBlock(ctx: ConversationContext): string {
  if (!ctx.isKnown) return '';
  const lines: string[] = [
    'CONTINUIDAD (importante): este contacto YA habló antes. NO reinicies ni muestres el menú inicial; retomá el hilo con naturalidad, como un empleado que lo reconoce.',
  ];
  if (ctx.longTermSummary) lines.push(`Resumen previo: ${ctx.longTermSummary}`);
  if (ctx.lastTopic) lines.push(`Último tema: ${ctx.lastTopic}.`);
  if (ctx.openAppointment) {
    const fecha = ctx.openAppointment.fechaTexto || fmtFecha(ctx.openAppointment.start_time) || 'agendada';
    const ofi = ctx.openAppointment.oficina ? ` en ${ctx.openAppointment.oficina}` : '';
    lines.push(`Tiene una cita ${ctx.openAppointment.status ?? 'pendiente'}${ofi}: ${fecha} (appointment_id: ${ctx.openAppointment.id}). Si escribe de nuevo, puede querer confirmarla, cambiar el HORARIO o la SEDE, o cancelarla: usá ese appointment_id con reschedule_appointment (pasá la nueva oficina si cambia de sede) o cancel_appointment. Confirmá el cambio antes de aplicarlo.`);
  }
  return lines.join('\n');
}

export class ConversationContextLoader {
  constructor(private deps: ContextLoaderDeps) {}

  async load(accountId: string, phone: string): Promise<ConversationContext> {
    const now = (this.deps.now ?? (() => new Date()))();

    const [mem, hist, appt, offered] = await Promise.all([
      this.deps.loadMemory(accountId, phone).catch(() => null),
      this.deps.history(accountId, phone).catch(() => []),
      this.deps.nextAppointment(accountId, phone).catch(() => null),
      this.deps.offeredOptions(accountId, phone).catch(() => []),
    ]);

    const profile = mem?.profile ?? {};
    const summary = mem?.summary ?? null;
    const lastInteractionAt = mem?.lastInteractionAt ?? null;
    const lastTopic = mem?.lastTopic ?? null;
    const recentHistory = hist ?? [];

    // Conocido = hay memoria persistida O historial. La rehidratación (rule 3) cuelga
    // de acá: aunque Redis esté vacío, si Supabase tiene resumen/perfil → seguimos sabiendo quién es.
    const isKnown = !!(
      summary || lastTopic || lastInteractionAt ||
      (profile && Object.keys(profile).length > 0) ||
      recentHistory.length > 0
    );

    const openAppointment = appt
      ? { ...appt, fechaTexto: appt.fechaTexto ?? fmtFecha(appt.start_time) ?? undefined }
      : null;

    const ctx: ConversationContext = {
      contact: profile,
      longTermSummary: summary,
      openAppointment,
      lastTopic,
      lastInteractionAt,
      recentHistory,
      lastOfferedOptions: offered ?? [],
      isKnown,
      isReturning: false,
    };
    ctx.isReturning = isReturning({ lastInteractionAt, isKnown }, now);
    return ctx;
  }
}

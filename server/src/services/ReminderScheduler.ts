import type { AccountManager } from '../core/accounts/AccountManager';
import { AppointmentService } from './AppointmentService';
import { messageStore } from './MessageStore';
import { supabase } from '../config/supabase';
import { esPsid } from '../utils/psid';

/**
 * ReminderScheduler — recordatorio proactivo de citas por WhatsApp.
 *
 * Cada minuto revisa las citas y envía un recordatorio ~20 min antes del turno.
 * Reglas:
 *  - Solo si la cuenta está conectada.
 *  - Solo dentro de la ventana de 24h: debe existir un mensaje ENTRANTE del
 *    contacto en las últimas 24h (política de WhatsApp para mensajes libres).
 *  - Idempotente: marca la cita como `reminded` para no repetir.
 *  - No recuerda citas canceladas ni ya pasadas.
 */
/** Fin del día (23:59:59) de la fecha dada, en horario Argentina (UTC-3), en ms UTC. */
export function endOfDayArMs(ms: number): number {
  const AR_OFFSET = 3 * 60 * 60 * 1000; // UTC-3
  const local = new Date(ms - AR_OFFSET);
  local.setUTCHours(23, 59, 59, 999);
  return local.getTime() + AR_OFFSET;
}

/**
 * ¿Corresponde auto-marcar la cita como no_asistio? (pura, para testear)
 * Reglas:
 *  - Solo pendiente/confirmada con start_time y con su día (AR) ya cerrado.
 *  - No backfilled: creada DESPUÉS de su horario = carga manual sobre algo pasado.
 *  - CONFIRMADA editada DESPUÉS del cierre de su día → NO tocar: es una decisión
 *    humana posterior (la operadora llama al otro día y la confirma). En prod el
 *    barrido corría cada minuto y volvía a pisar esas confirmaciones con no_asistio.
 */
export function debeMarcarNoShow(
  a: { status: string; start_time?: string | null; created_at?: string | null; updated_at?: string | null },
  nowMs: number,
): boolean {
  if (!a.start_time) return false;
  if (a.status !== 'pendiente' && a.status !== 'confirmada') return false;
  const startMs = new Date(a.start_time).getTime();
  if (a.created_at && new Date(a.created_at).getTime() > startMs) return false;
  const eod = endOfDayArMs(startMs);
  if (a.status === 'confirmada' && a.updated_at && new Date(a.updated_at).getTime() > eod) return false;
  return nowMs > eod;
}

/**
 * Texto del recordatorio (pura, para testear). Si el "nombre" de la cita es un PSID
 * de FB/IG, saluda sin nombre: en prod salió "¡Hola, 27208676225498134!" al cliente.
 */
export function textoRecordatorio(nombre: string | null | undefined, hora: string): string {
  const n = nombre && !esPsid(nombre) ? `, ${nombre}` : '';
  return `⏰ ¡Hola${n}! Te recordamos tu *cita* de hoy a las *${hora} hs*. ¡Te esperamos! 🟢`;
}

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private readonly DEFAULT_MINUTES = 20; // fallback si la cuenta no define reminder_minutes
  private readonly WINDOW_24H_MS = 24 * 60 * 60 * 1000;
  private readonly TICK_MS = 60 * 1000; // cada minuto

  constructor(private manager: AccountManager) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error('[ReminderScheduler] tick error:', e?.message ?? e));
    }, this.TICK_MS);
    console.log('⏰ [ReminderScheduler] activo (recordatorios 20 min antes, ventana 24h)');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private isConnected(accountId: string): boolean {
    const s = this.manager.getStatus(accountId);
    return s === 'WORKING' || s === 'connected';
  }

  /** Mapa account_id → minutos de anticipación configurados (default 20). */
  private async loadReminderMinutes(): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    try {
      const { data } = await supabase.from('accounts').select('id, reminder_minutes');
      for (const row of data ?? []) {
        const m = Number((row as any).reminder_minutes);
        map.set((row as any).id, Number.isFinite(m) && m > 0 ? m : this.DEFAULT_MINUTES);
      }
    } catch {
      // si falla, todos caen al default vía el ?? de abajo
    }
    return map;
  }

  async tick(): Promise<void> {
    if (this.running) return; // evita solapamiento si un tick tarda
    this.running = true;
    try {
      const now = Date.now();
      // Ventana ±24h en vez de toda la tabla: el recordatorio (lead ≤ 60min) y el
      // no-show (fin del día) caen dentro de esa ventana. Evita full-scan por minuto.
      const appointments = await AppointmentService.listSchedulerWindow(this.WINDOW_24H_MS);
      const minutesByAccount = await this.loadReminderMinutes();

      for (const a of appointments) {
        if (a.status === 'cancelada' || a.reminded || !a.start_time) continue;

        const leadMs = (minutesByAccount.get(a.account_id) ?? this.DEFAULT_MINUTES) * 60 * 1000;
        const startMs = new Date(a.start_time).getTime();
        const msUntil = startMs - now;
        // Disparar cuando faltan <= lead (config por cuenta) y la cita no empezó todavía.
        if (msUntil <= 0 || msUntil > leadMs) continue;

        if (!this.isConnected(a.account_id)) {
          // Cuenta desconectada: no marcamos, reintenta en el próximo tick.
          continue;
        }

        // Ventana de 24h: debe haber un entrante reciente del contacto.
        const lastIn = await messageStore.getLastInboundAt(a.account_id, a.phone);
        if (!lastIn || (now - lastIn.getTime()) > this.WINDOW_24H_MS) {
          console.log(`[ReminderScheduler] cita ${a.id} fuera de ventana 24h (${a.phone}) — no se envía.`);
          // Marcamos para no reevaluar cada minuto una cita inelegible.
          await AppointmentService.update(a.id, { reminded: true }).catch(() => {});
          continue;
        }

        const hora = new Date(a.start_time).toLocaleTimeString('es-AR', {
          hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/Argentina/Buenos_Aires',
        });
        const texto = textoRecordatorio(a.nombre, hora);

        try {
          await this.manager.sendMessage(a.account_id, a.phone, texto);
          await AppointmentService.update(a.id, { reminded: true });
          console.log(`[ReminderScheduler] recordatorio enviado a ${a.phone} (cita ${a.id} ${hora}hs)`);
        } catch (err: any) {
          console.error(`[ReminderScheduler] error enviando recordatorio cita ${a.id}:`, err?.message ?? err);
          // No marcamos: reintenta el próximo tick (sigue dentro de la ventana de 20').
        }
      }

      // --- No-show: al cierre del día (hora AR), las citas no marcadas pasan a 'no_asistio' ---
      // (Modo semi: solo marca; el recontacto lo hace el operador desde el inbox.
      //  Reglas de elegibilidad en debeMarcarNoShow, incluida la de respetar la
      //  confirmación manual posterior al día de la cita.)
      for (const a of appointments) {
        if (debeMarcarNoShow(a as any, now)) {
          await AppointmentService.update(a.id, { status: 'no_asistio' }).catch(() => {});
          console.log(`[ReminderScheduler] no-show marcado: cita ${a.id} (${a.nombre || a.phone}) — para recontactar`);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

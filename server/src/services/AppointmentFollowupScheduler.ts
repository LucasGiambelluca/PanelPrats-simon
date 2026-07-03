import type { AccountManager } from '../core/accounts/AccountManager';
import { AppointmentService } from './AppointmentService';
import { buildTemplate } from './whatsappTemplates';
import { dueAppointmentEvents, fechaAR, horaAR, type SchedulerCfg } from './appointmentFollowupLogic';

/**
 * AppointmentFollowupScheduler — mensajes proactivos por template (fuera de la
 * ventana de 24h de WhatsApp): recordatorio 24h antes y seguimiento post-reunión.
 * Convive con ReminderScheduler (recordatorio corto del día + no_asistio).
 */
export class AppointmentFollowupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private readonly TICK_MS = 60 * 1000;
  private readonly PAST_MS = 3 * 24 * 60 * 60 * 1000;   // hasta 3 días después del turno
  private readonly FUTURE_MS = 2 * 24 * 60 * 60 * 1000; // hasta 2 días antes del turno
  private readonly CFG: SchedulerCfg = { reminder24hEnabled: true, followupEnabled: true };

  constructor(private manager: AccountManager) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error('[FollowupScheduler] tick error:', e?.message ?? e));
    }, this.TICK_MS);
    console.log('📨 [AppointmentFollowupScheduler] activo (reminder 24h + post-reunión por template)');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private isConnected(accountId: string): boolean {
    const s = this.manager.getStatus(accountId);
    return s === 'WORKING' || s === 'connected';
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const appts = await AppointmentService.listFollowupWindow(this.PAST_MS, this.FUTURE_MS);
      for (const a of appts) {
        const events = dueAppointmentEvents(a as any, now, this.CFG);
        if (!events.length) continue;
        if (!this.isConnected(a.account_id)) continue; // reintenta el próximo tick

        const nombre = a.nombre?.trim() || 'Hola';
        for (const ev of events) {
          try {
            if (ev === 'reminder_24h' && a.start_time) {
              const sede = a.oficina?.trim() || 'el estudio';
              const t = buildTemplate('reminder_24h', [nombre, fechaAR(a.start_time), horaAR(a.start_time), sede]);
              await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
              await AppointmentService.setSchedulerFlags(a.id, { reminder_24h_sent: true });
              console.log(`[FollowupScheduler] reminder_24h → ${a.phone} (cita ${a.id})`);
            } else if (ev === 'followup' && a.start_time) {
              // no_asistio → reagendar; resto → seguimiento. (Plan C: si hay docs
              // pendientes, se manda docs_pendientes en vez de seguimiento.)
              const t = a.status === 'no_asistio'
                ? buildTemplate('reagendar', [nombre, fechaAR(a.start_time)])
                : buildTemplate('seguimiento', [nombre]);
              await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
              await AppointmentService.setSchedulerFlags(a.id, { followup_sent: true });
              console.log(`[FollowupScheduler] followup(${a.status}) → ${a.phone} (cita ${a.id})`);
            }
          } catch (err: any) {
            // No marcamos el flag: reintenta el próximo tick.
            console.error(`[FollowupScheduler] error evento ${ev} cita ${a.id}:`, err?.message ?? err);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}

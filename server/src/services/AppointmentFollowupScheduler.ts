import type { AccountManager } from '../core/accounts/AccountManager';
import { AppointmentService } from './AppointmentService';
import { AppointmentDocsService } from './AppointmentDocsService';
import { buildTemplate } from './whatsappTemplates';
import { dueAppointmentEvents, docChaseDue, fechaAR, horaAR, type SchedulerCfg, type DocChaseCfg } from './appointmentFollowupLogic';

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
  private readonly DOC_CFG: DocChaseCfg = { docChaseEnabled: true, everyDays: 3, max: 3 };

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
      const nowIso = new Date(now).toISOString();
      const appts = await AppointmentService.listFollowupWindow(this.PAST_MS, this.FUTURE_MS);
      const pendingByAppt = await AppointmentDocsService.pendingByAppointmentIds(appts.map((a) => a.id));

      for (const a of appts) {
        if (!this.isConnected(a.account_id)) continue;
        const nombre = a.nombre?.trim() || 'Hola';
        const pending = pendingByAppt.get(a.id) ?? [];
        const events = dueAppointmentEvents(a as any, now, this.CFG);

        for (const ev of events) {
          try {
            if (ev === 'reminder_24h' && a.start_time) {
              const sede = a.oficina?.trim() || 'el estudio';
              const t = buildTemplate('reminder_24h', [nombre, fechaAR(a.start_time), horaAR(a.start_time), sede]);
              await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
              await AppointmentService.setSchedulerFlags(a.id, { reminder_24h_sent: true });
            } else if (ev === 'followup' && a.start_time) {
              if (a.status === 'no_asistio') {
                const t = buildTemplate('reagendar', [nombre, fechaAR(a.start_time)]);
                await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
                await AppointmentService.setSchedulerFlags(a.id, { followup_sent: true });
              } else if (pending.length > 0) {
                // Follow-up + primer pedido de docs en un solo mensaje.
                const t = buildTemplate('docs_pendientes', [nombre, pending.join(', ')]);
                await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
                await AppointmentService.setSchedulerFlags(a.id, { followup_sent: true, doc_chase_count: 1, doc_chase_last_at: nowIso });
              } else {
                const t = buildTemplate('seguimiento', [nombre]);
                await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
                await AppointmentService.setSchedulerFlags(a.id, { followup_sent: true });
              }
            }
          } catch (err: any) {
            // No marcamos el flag: reintenta el próximo tick.
            console.error(`[FollowupScheduler] error evento ${ev} cita ${a.id}:`, err?.message ?? err);
          }
        }

        // Chase de documentación (recordatorios siguientes al primer pedido).
        if (docChaseDue(a as any, pending.length, now, this.DOC_CFG)) {
          try {
            const t = buildTemplate('docs_pendientes', [nombre, pending.join(', ')]);
            await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
            await AppointmentService.setSchedulerFlags(a.id, {
              doc_chase_count: (a.doc_chase_count ?? 0) + 1,
              doc_chase_last_at: nowIso,
            });
            console.log(`[FollowupScheduler] doc_chase → ${a.phone} (cita ${a.id})`);
          } catch (err: any) {
            console.error(`[FollowupScheduler] error doc_chase cita ${a.id}:`, err?.message ?? err);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}

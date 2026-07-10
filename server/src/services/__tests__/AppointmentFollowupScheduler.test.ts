import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AppointmentFollowupScheduler } from '../AppointmentFollowupScheduler';
import { AppointmentService } from '../AppointmentService';
import { AppointmentDocsService } from '../AppointmentDocsService';

// Caso prod 2026-07-09: el scheduler intentaba mandar templates por cuentas
// FB/IG/baileys (que no los soportan) y llenaba los logs con el mismo error
// cada tick, para siempre. Las cuentas sin soporte de templates se saltean.
describe('AppointmentFollowupScheduler — cuentas sin templates', () => {
  const citaConReminderDue = () => ({
    id: 'c1', account_id: 'accFB', phone: 'p1', nombre: 'Juan', status: 'pendiente',
    start_time: new Date(Date.now() + 23 * 3600 * 1000).toISOString(),
  });

  beforeEach(() => {
    vi.spyOn(AppointmentService, 'listFollowupWindow').mockResolvedValue([citaConReminderDue() as any]);
    vi.spyOn(AppointmentDocsService, 'pendingByAppointmentIds').mockResolvedValue(new Map());
    vi.spyOn(AppointmentService, 'setSchedulerFlags').mockResolvedValue();
  });
  afterEach(() => vi.restoreAllMocks());

  const makeManager = (supports: boolean) => ({
    getStatus: () => 'connected',
    supportsTemplates: vi.fn(() => supports),
    sendTemplate: vi.fn().mockResolvedValue(undefined),
  });

  it('cuenta que NO soporta templates → saltea sin intentar enviar ni loguear error', async () => {
    const manager = makeManager(false);
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const s = new AppointmentFollowupScheduler(manager as any);
    await s.tick();
    expect(manager.sendTemplate).not.toHaveBeenCalled();
    expect(AppointmentService.setSchedulerFlags).not.toHaveBeenCalled();
    expect(errSpy).not.toHaveBeenCalled();
  });

  it('cuenta oficial (soporta templates) → manda el reminder normal', async () => {
    const manager = makeManager(true);
    const s = new AppointmentFollowupScheduler(manager as any);
    await s.tick();
    expect(manager.sendTemplate).toHaveBeenCalledTimes(1);
    expect(AppointmentService.setSchedulerFlags).toHaveBeenCalledWith('c1', { reminder_24h_sent: true });
  });

  it('manager viejo sin supportsTemplates → no rompe (degrada a intentar como antes)', async () => {
    const manager: any = makeManager(true);
    delete manager.supportsTemplates;
    const s = new AppointmentFollowupScheduler(manager as any);
    await s.tick();
    expect(manager.sendTemplate).toHaveBeenCalledTimes(1);
  });
});

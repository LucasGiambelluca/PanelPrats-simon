import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppointmentProposalsExecutor } from '../AppointmentProposalsExecutor';
import { AppointmentService } from '../../../services/AppointmentService';

const freeSlots = vi.fn();
const getOffice = vi.fn();
vi.mock('../../../services/AvailabilityService', () => ({
  AvailabilityService: class { freeSlots = (...a: any[]) => freeSlots(...a); getOffice = (...a: any[]) => getOffice(...a); },
}));

describe('AppointmentProposalsExecutor', () => {
  const accountId = 'fbf99cec-ddc9-4ef2-94d0-8f14d0bcb982';

  beforeEach(async () => {
    const list = await AppointmentService.list(accountId);
    for (const app of list) {
      await AppointmentService.delete(app.id);
    }
  });

  it('debe proponer la cantidad configurada de horarios libres excluyendo fines de semana por defecto', async () => {
    const executor = new AppointmentProposalsExecutor();
    const context: any = { accountId };

    await executor.execute({
      allowedDays: [1, 2, 3, 4, 5], // lunes a viernes
      startHour: '09:00',
      endHour: '12:00',
      slotDuration: 60,
      maxProposals: 3,
      outputVariable: 'propuestas'
    }, context);

    expect(context.propuestas).toBeDefined();
    expect(context.propuestas_array).toHaveLength(3);

    // Verificar que los horarios propuestos son en días hábiles (1-5)
    for (const slot of context.propuestas_array) {
      const day = new Date(slot.start).getDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);

      const hour = new Date(slot.start).getHours();
      expect(hour).toBeGreaterThanOrEqual(9);
      expect(hour).toBeLessThan(12);
    }
  });

  it('debe respetar el filtro de días específicos (ej: martes a jueves)', async () => {
    const executor = new AppointmentProposalsExecutor();
    const context: any = { accountId };

    await executor.execute({
      allowedDays: [2, 3, 4], // martes, miércoles, jueves
      startHour: '10:00',
      endHour: '11:00',
      slotDuration: 60,
      maxProposals: 5,
      outputVariable: 'propuestas'
    }, context);

    expect(context.propuestas_array).toHaveLength(5);

    for (const slot of context.propuestas_array) {
      const day = new Date(slot.start).getDay();
      // Debe ser martes (2), miércoles (3) o jueves (4)
      expect([2, 3, 4]).toContain(day);
    }
  });

  it('debe omitir los slots que se solapan con citas existentes', async () => {
    // Vamos a reservar un slot específico para forzar al executor a saltearlo.
    // Buscaremos el primer slot propuesto en condiciones normales, y luego lo reservaremos.
    const executor = new AppointmentProposalsExecutor();
    const contextBase: any = { accountId };

    await executor.execute({
      allowedDays: [1], // solo lunes
      startHour: '09:00',
      endHour: '11:00',
      slotDuration: 60,
      maxProposals: 2,
      outputVariable: 'propuestas'
    }, contextBase);

    // El primer slot libre
    const firstFreeSlot = contextBase.propuestas_array[0];
    
    // Lo reservamos en la base de datos (memoria)
    await AppointmentService.create({
      account_id: accountId,
      phone: '123456789',
      nombre: 'Paciente Ocupante',
      telefono: '123456789',
      resumen: 'Ocupado',
      status: 'pendiente',
      start_time: firstFreeSlot.start,
      end_time: firstFreeSlot.end,
    });

    // Rerunning the search
    const contextAfter: any = { accountId };
    await executor.execute({
      allowedDays: [1],
      startHour: '09:00',
      endHour: '11:00',
      slotDuration: 60,
      maxProposals: 2,
      outputVariable: 'propuestas'
    }, contextAfter);

    // El slot que antes estaba libre y ahora está reservado, NO debe aparecer en la nueva lista de propuestas
    const newStarts = contextAfter.propuestas_array.map((s: any) => s.start);
    expect(newStarts).not.toContain(firstFreeSlot.start);
  });

  it('si la oficina está configurada, delega los horarios en AvailabilityService', async () => {
    getOffice.mockResolvedValue({ nombre: 'CABA', capacidad: 1, slot_min: 60 }); // configurada → delega
    freeSlots.mockResolvedValue([{ start: '2026-06-22T13:00:00.000Z', end: '2026-06-22T14:00:00.000Z' }]);
    const exec = new AppointmentProposalsExecutor();
    const ctx: any = { accountId: 'acc1', oficina: 'CABA' };
    const res = await exec.execute({ oficinaVar: 'oficina' }, ctx);
    expect(getOffice).toHaveBeenCalledWith('acc1', 'CABA');
    expect(freeSlots).toHaveBeenCalledWith('acc1', 'CABA', expect.any(Object));
    expect(res.messages.length).toBeGreaterThan(0);
    expect(res.messages[0]).toMatch(/\d{2}:\d{2}/); // formateó el slot delegado
  });
});

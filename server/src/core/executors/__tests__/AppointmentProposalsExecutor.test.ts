import { describe, it, expect, beforeEach } from 'vitest';
import { AppointmentProposalsExecutor } from '../AppointmentProposalsExecutor';
import { AppointmentService } from '../../../services/AppointmentService';

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
});

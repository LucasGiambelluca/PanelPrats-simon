import { describe, it, expect, beforeEach } from 'vitest';
import { AppointmentAvailabilityExecutor } from '../AppointmentAvailabilityExecutor';
import { AppointmentService } from '../../../services/AppointmentService';

describe('AppointmentAvailabilityExecutor', () => {
  const accountId = 'fbf99cec-ddc9-4ef2-94d0-8f14d0bcb982';

  beforeEach(async () => {
    // Limpiar citas en memoria si existen
    const list = await AppointmentService.list(accountId);
    for (const app of list) {
      await AppointmentService.delete(app.id);
    }
  });

  it('debe retornar true si no hay citas agendadas', async () => {
    const executor = new AppointmentAvailabilityExecutor();
    const context = {
      accountId,
      phone: '123456789',
      fecha: '2026-06-20',
      hora_inicio: '10:00',
      hora_fin: '11:00',
    };

    const res = await executor.execute(
      { dateVar: 'fecha', startHourVar: 'hora_inicio', endHourVar: 'hora_fin' },
      context as any
    );

    expect(res.conditionResult).toBe(true);
  });

  it('debe retornar false si hay una cita que se solapa', async () => {
    // Crear cita previa usando Date local para que coincida con buildISO del executor
    const start_time = new Date('2026-06-20T10:00').toISOString();
    const end_time = new Date('2026-06-20T11:00').toISOString();

    await AppointmentService.create({
      account_id: accountId,
      phone: '123456789',
      nombre: 'Cliente Existente',
      telefono: '123456789',
      resumen: 'Consulta general',
      status: 'pendiente',
      start_time,
      end_time,
    });

    const executor = new AppointmentAvailabilityExecutor();
    
    // Caso de prueba: Intentar agendar a la misma hora (10:00 - 11:00)
    const contextOverlap = {
      accountId,
      phone: '987654321',
      fecha: '2026-06-20',
      hora_inicio: '10:00',
      hora_fin: '11:00',
    };

    const resOverlap = await executor.execute(
      { dateVar: 'fecha', startHourVar: 'hora_inicio', endHourVar: 'hora_fin' },
      contextOverlap as any
    );

    expect(resOverlap.conditionResult).toBe(false);

    // Caso de prueba: Intentar agendar con solapamiento parcial (10:30 - 11:30)
    const contextPartial = {
      accountId,
      phone: '987654321',
      fecha: '2026-06-20',
      hora_inicio: '10:30',
      hora_fin: '11:30',
    };

    const resPartial = await executor.execute(
      { dateVar: 'fecha', startHourVar: 'hora_inicio', endHourVar: 'hora_fin' },
      contextPartial as any
    );

    expect(resPartial.conditionResult).toBe(false);
  });

  it('debe retornar true si hay citas pero no se solapan', async () => {
    const start_time = new Date('2026-06-20T10:00').toISOString();
    const end_time = new Date('2026-06-20T11:00').toISOString();

    // Crear cita previa: 2026-06-20 de 10:00 a 11:00
    await AppointmentService.create({
      account_id: accountId,
      phone: '123456789',
      nombre: 'Cliente Existente',
      telefono: '123456789',
      resumen: 'Consulta general',
      status: 'pendiente',
      start_time,
      end_time,
    });

    const executor = new AppointmentAvailabilityExecutor();

    // Caso de prueba: Intentar agendar más tarde (11:00 - 12:00)
    const contextAfter = {
      accountId,
      phone: '987654321',
      fecha: '2026-06-20',
      hora_inicio: '11:00',
      hora_fin: '12:00',
    };

    const resAfter = await executor.execute(
      { dateVar: 'fecha', startHourVar: 'hora_inicio', endHourVar: 'hora_fin' },
      contextAfter as any
    );

    expect(resAfter.conditionResult).toBe(true);
  });
});

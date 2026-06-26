import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test aislado: mockeamos AppointmentService para NO pegar a la DB (antes este
// test usaba el servicio real → con Supabase configurado fallaba por FK contra una
// cuenta de prueba inexistente). Acá probamos la lógica de solapamiento del executor.
const list = vi.fn();
vi.mock('../../../services/AppointmentService', () => ({
  AppointmentService: { list: (...a: any[]) => list(...a) },
}));

import { AppointmentAvailabilityExecutor } from '../AppointmentAvailabilityExecutor';

const NODE = { dateVar: 'fecha', startHourVar: 'hora_inicio', endHourVar: 'hora_fin' };
const ctx = (over: Record<string, any> = {}) =>
  ({ accountId: 'acc1', phone: 'p', fecha: '2026-06-20', hora_inicio: '10:00', hora_fin: '11:00', ...over }) as any;

// buildISO del executor usa `new Date(\`${date}T${t}\`)` (hora LOCAL); replicamos igual.
const localISO = (date: string, hhmm: string) => new Date(`${date}T${hhmm}`).toISOString();

describe('AppointmentAvailabilityExecutor', () => {
  beforeEach(() => { list.mockReset(); });

  it('true si no hay citas agendadas', async () => {
    list.mockResolvedValue([]);
    const r = await new AppointmentAvailabilityExecutor().execute(NODE, ctx());
    expect(r.conditionResult).toBe(true);
  });

  it('false si una cita se solapa exactamente', async () => {
    list.mockResolvedValue([{ status: 'pendiente', start_time: localISO('2026-06-20', '10:00'), end_time: localISO('2026-06-20', '11:00') }]);
    const r = await new AppointmentAvailabilityExecutor().execute(NODE, ctx());
    expect(r.conditionResult).toBe(false);
  });

  it('false en solapamiento parcial (10:30-11:30 vs 10:00-11:00)', async () => {
    list.mockResolvedValue([{ status: 'pendiente', start_time: localISO('2026-06-20', '10:00'), end_time: localISO('2026-06-20', '11:00') }]);
    const r = await new AppointmentAvailabilityExecutor().execute(NODE, ctx({ hora_inicio: '10:30', hora_fin: '11:30' }));
    expect(r.conditionResult).toBe(false);
  });

  it('true si la cita existente NO se solapa (11:00-12:00 vs 10:00-11:00)', async () => {
    list.mockResolvedValue([{ status: 'pendiente', start_time: localISO('2026-06-20', '10:00'), end_time: localISO('2026-06-20', '11:00') }]);
    const r = await new AppointmentAvailabilityExecutor().execute(NODE, ctx({ hora_inicio: '11:00', hora_fin: '12:00' }));
    expect(r.conditionResult).toBe(true);
  });

  it('ignora las citas canceladas', async () => {
    list.mockResolvedValue([{ status: 'cancelada', start_time: localISO('2026-06-20', '10:00'), end_time: localISO('2026-06-20', '11:00') }]);
    const r = await new AppointmentAvailabilityExecutor().execute(NODE, ctx());
    expect(r.conditionResult).toBe(true);
  });

  it('false si la fecha es inválida (no se puede chequear)', async () => {
    list.mockResolvedValue([]);
    const r = await new AppointmentAvailabilityExecutor().execute(NODE, ctx({ fecha: '' }));
    expect(r.conditionResult).toBe(false);
  });
});

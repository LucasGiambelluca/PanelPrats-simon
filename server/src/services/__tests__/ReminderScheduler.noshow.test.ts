import { describe, it, expect } from 'vitest';
import { debeMarcarNoShow, endOfDayArMs } from '../ReminderScheduler';

// Ticket 2026-07-07 (R.Prats): confirmó las citas de ayer a la mañana y el barrido
// no-show (cada minuto) las volvía a pisar con no_asistio, una y otra vez.
describe('debeMarcarNoShow — no pisar decisiones humanas posteriores', () => {
  // Cita ayer 15:00 AR (18:00 UTC); "hoy" 2026-07-07 09:35 AR (12:35 UTC).
  const AYER_START = '2026-07-06T18:00:00.000Z';
  const ANTEAYER = '2026-07-05T12:00:00.000Z';
  const HOY_0935_AR = Date.parse('2026-07-07T12:35:00.000Z');

  it('pendiente de ayer, sin tocar → no-show (comportamiento original)', () => {
    const a = { status: 'pendiente', start_time: AYER_START, created_at: ANTEAYER, updated_at: ANTEAYER };
    expect(debeMarcarNoShow(a, HOY_0935_AR)).toBe(true);
  });

  it('confirmada ANTES de la cita y no asistió → no-show al cierre del día', () => {
    const a = { status: 'confirmada', start_time: AYER_START, created_at: ANTEAYER, updated_at: '2026-07-06T13:00:00.000Z' };
    expect(debeMarcarNoShow(a, HOY_0935_AR)).toBe(true);
  });

  it('confirmada HOY (después del cierre del día de la cita) → respetar, NO pisar', () => {
    const a = { status: 'confirmada', start_time: AYER_START, created_at: ANTEAYER, updated_at: '2026-07-07T12:32:00.000Z' };
    expect(debeMarcarNoShow(a, HOY_0935_AR)).toBe(false);
  });

  it('cita de HOY (día no cerrado) → nunca', () => {
    const a = { status: 'pendiente', start_time: '2026-07-07T19:00:00.000Z', created_at: ANTEAYER, updated_at: ANTEAYER };
    expect(debeMarcarNoShow(a, HOY_0935_AR)).toBe(false);
  });

  it('backfilled (creada después de su horario) → nunca', () => {
    const a = { status: 'pendiente', start_time: AYER_START, created_at: '2026-07-06T20:00:00.000Z', updated_at: '2026-07-06T20:00:00.000Z' };
    expect(debeMarcarNoShow(a, HOY_0935_AR)).toBe(false);
  });

  it('estados terminales (asistio/cancelada/no_asistio) → nunca', () => {
    for (const status of ['asistio', 'cancelada', 'no_asistio', 'cerrado']) {
      expect(debeMarcarNoShow({ status, start_time: AYER_START, created_at: ANTEAYER }, HOY_0935_AR)).toBe(false);
    }
  });

  it('sin start_time → nunca', () => {
    expect(debeMarcarNoShow({ status: 'pendiente', start_time: null }, HOY_0935_AR)).toBe(false);
  });

  it('endOfDayArMs: el día AR cierra 23:59:59 hora Argentina (02:59:59Z del siguiente)', () => {
    // 2026-07-06 15:00 AR → cierre 2026-07-07T02:59:59.999Z
    expect(new Date(endOfDayArMs(Date.parse(AYER_START))).toISOString()).toBe('2026-07-07T02:59:59.999Z');
  });
});

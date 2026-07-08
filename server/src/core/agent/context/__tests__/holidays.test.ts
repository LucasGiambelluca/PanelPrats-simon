import { describe, it, expect } from 'vitest';
import { isHolidayAR, isHolidayARInstant } from '../holidays';
describe('isHolidayAR', () => {
  it('9 de julio 2026 es feriado', () => { expect(isHolidayAR('2026-07-09')).toBe(true); });
  it('10 de julio 2026 es puente no laborable', () => { expect(isHolidayAR('2026-07-10')).toBe(true); });
  it('lunes 13 de julio 2026 es hábil', () => { expect(isHolidayAR('2026-07-13')).toBe(false); });
  it('un martes común no es feriado', () => { expect(isHolidayAR('2026-07-07')).toBe(false); });
  it('navidad 2026', () => { expect(isHolidayAR('2026-12-25')).toBe(true); });
});
describe('isHolidayARInstant', () => {
  // 2026-07-09T13:00Z = 10:00 hora AR del jueves feriado.
  it('instante UTC que cae en feriado AR', () => { expect(isHolidayARInstant('2026-07-09T13:00:00.000Z')).toBe(true); });
  // 2026-07-11T01:00Z = viernes 10/07 22:00 hora AR (aún puente).
  it('borde de día: UTC ya es sábado pero en AR sigue el puente', () => { expect(isHolidayARInstant('2026-07-11T01:00:00.000Z')).toBe(true); });
  it('lunes hábil no es feriado', () => { expect(isHolidayARInstant('2026-07-13T13:00:00.000Z')).toBe(false); });
  it('fecha inválida devuelve false (la valida otro guard)', () => { expect(isHolidayARInstant('no-es-fecha')).toBe(false); });
});

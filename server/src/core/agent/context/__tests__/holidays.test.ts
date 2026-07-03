import { describe, it, expect } from 'vitest';
import { isHolidayAR } from '../holidays';
describe('isHolidayAR', () => {
  it('9 de julio 2026 es feriado', () => { expect(isHolidayAR('2026-07-09')).toBe(true); });
  it('un martes común no es feriado', () => { expect(isHolidayAR('2026-07-07')).toBe(false); });
  it('navidad 2026', () => { expect(isHolidayAR('2026-12-25')).toBe(true); });
});

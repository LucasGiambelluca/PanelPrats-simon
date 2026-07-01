import { describe, it, expect } from 'vitest';
import { validarTelefonoAR } from '../phone-ar';

describe('validarTelefonoAR', () => {
  it('CABA 10 dígitos → válido y normaliza a 54 + 10', () => {
    const r = validarTelefonoAR('1123456789');
    expect(r.valido).toBe(true);
    expect(r.normalizado).toBe('541123456789');
  });

  it('tolera prefijos +54 / 0 / 15 / 9 y normaliza al mismo número', () => {
    for (const t of ['+54 11 2345-6789', '011 2345 6789', '11 15 2345 6789', '5491123456789', '+5491123456789']) {
      const r = validarTelefonoAR(t);
      expect(r.valido, t).toBe(true);
      expect(r.normalizado, t).toBe('541123456789');
    }
  });

  it('área de 3 dígitos válida (La Plata 221)', () => {
    const r = validarTelefonoAR('2214567890');
    expect(r.valido).toBe(true);
    expect(r.normalizado).toBe('542214567890');
  });

  it('primer dígito fuera de 1/2/3 → inválido (area_desconocida)', () => {
    const r = validarTelefonoAR('4567890123'); // 10 díg pero arranca en 4
    expect(r.valido).toBe(false);
    expect(r.motivo).toBe('area_desconocida');
  });

  it('largo inválido → largo_invalido', () => {
    expect(validarTelefonoAR('12345').motivo).toBe('largo_invalido');
  });

  it('REGRESIÓN: números reales del interior que la lista blanca rechazaba → válidos', () => {
    // Casos sacados de conversaciones de prod donde el agendado moría por teléfono.
    const casos: Array<[string, string]> = [
      ['3446406753', '543446406753'],   // Gualeguaychú (área 3446)
      ['2932449224', '542932449224'],   // Punta Alta (área 2932)
      ['3757222829', '543757222829'],   // Eldorado, Misiones (área 3757)
      ['2984782478', '542984782478'],   // Río Negro (área 2984)
      ['03446 15406753', '543446406753'], // mismo Gualeguaychú con 0 y 15 viejo
    ];
    for (const [entrada, esperado] of casos) {
      const r = validarTelefonoAR(entrada);
      expect(r.valido, entrada).toBe(true);
      expect(r.normalizado, entrada).toBe(esperado);
    }
  });

  it('sin dígitos → vacio', () => {
    expect(validarTelefonoAR('no tengo').motivo).toBe('vacio');
    expect(validarTelefonoAR('').motivo).toBe('vacio');
  });
});

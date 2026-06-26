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

  it('código de área inexistente → inválido (area_desconocida)', () => {
    const r = validarTelefonoAR('9991234567');
    expect(r.valido).toBe(false);
    expect(r.motivo).toBe('area_desconocida');
  });

  it('largo inválido → largo_invalido', () => {
    expect(validarTelefonoAR('12345').motivo).toBe('largo_invalido');
  });

  it('sin dígitos → vacio', () => {
    expect(validarTelefonoAR('no tengo').motivo).toBe('vacio');
    expect(validarTelefonoAR('').motivo).toBe('vacio');
  });
});

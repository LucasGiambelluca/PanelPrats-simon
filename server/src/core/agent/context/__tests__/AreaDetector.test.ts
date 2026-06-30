import { describe, it, expect } from 'vitest';
import { detectArea } from '../AreaDetector';

describe('detectArea', () => {
  it('jubilación de mujer (caso real del bug)', () => {
    expect(detectArea('¿Puedo reservar una cita por Jubilacion de mujer?')).toBe('jubilacion_mujer');
  });
  it('jubilación de hombre', () => {
    expect(detectArea('quiero la jubilación de hombre')).toBe('jubilacion_hombre');
  });
  it('jubilación sin género', () => {
    expect(detectArea('me quiero jubilar')).toBe('jubilacion');
  });
  it('pensión por viudez antes que jubilación', () => {
    expect(detectArea('pensión por viudez, falleció mi esposo')).toBe('pension_viudez');
  });
  it('laboral / despido', () => {
    expect(detectArea('me despidieron sin causa')).toBe('laboral');
  });
  it('ART / accidente de trabajo (no es tránsito)', () => {
    expect(detectArea('tuve un accidente de trabajo')).toBe('art');
  });
  it('accidente de tránsito', () => {
    expect(detectArea('me chocaron en la esquina')).toBe('transito');
  });
  it('pedido de turno SIN área → null', () => {
    expect(detectArea('quiero sacar un turno')).toBeNull();
  });
  it('vacío → null', () => {
    expect(detectArea('')).toBeNull();
  });
});

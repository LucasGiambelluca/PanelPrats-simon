import { describe, it, expect } from 'vitest';
import { interpolate } from '../interpolate';

describe('interpolate', () => {
  it('reemplaza variable presente', () => {
    expect(interpolate('Hola {{nombre}}!', { nombre: 'Lucía' })).toBe('Hola Lucía!');
  });
  it('var ausente → vacío y sin doble espacio', () => {
    expect(interpolate('¡Hola {{nombre}}! 👋', {})).toBe('¡Hola! 👋');
  });
  it('respeta espacios normales', () => {
    expect(interpolate('A {{x}} B', { x: 'y' })).toBe('A y B');
  });
});

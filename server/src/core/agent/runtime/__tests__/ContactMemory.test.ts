import { describe, it, expect } from 'vitest';
import { mergeProfile, buildFichaText, buildCalificacionFicha } from '../ContactMemory';

describe('ContactMemory.mergeProfile', () => {
  it('agrega slots nuevos sin pisar los existentes con null/undefined', () => {
    const prev = { nombre: 'María', edad: 63 };
    const next = { nombre: null, situacion_previsional: 'le faltan aportes', edad: undefined };
    expect(mergeProfile(prev, next)).toEqual({
      nombre: 'María', edad: 63, situacion_previsional: 'le faltan aportes',
    });
  });
});

describe('ContactMemory.buildFichaText', () => {
  it('arma una línea compacta con perfil + próxima cita', () => {
    const ficha = buildFichaText(
      { nombre: 'María', edad: 63, situacion_previsional: 'le faltan 2 años' },
      { horario_preferido: 'mañanas' },
      'Consultó moratoria.',
      'jue 26/6 11hs',
    );
    expect(ficha).toContain('María');
    expect(ficha).toContain('63');
    expect(ficha).toContain('mañanas');
    expect(ficha).toContain('jue 26/6 11hs');
  });

  it('no rompe cuando faltan datos', () => {
    const ficha = buildFichaText({}, {}, null, null);
    expect(typeof ficha).toBe('string');
  });
});

describe('ContactMemory.buildCalificacionFicha', () => {
  const NOW = Date.parse('2026-06-30T12:00:00.000Z');
  const fresca = {
    jubilacion_mujer: {
      resultado: 'gratis',
      datos: { edad: 61, hijos: 2, aportes_aprox: 22 },
      calificado_at: '2026-06-25T12:00:00.000Z', // hace 5 días
    },
  };

  it('inyecta una calificación vigente (< TTL) con sus datos', () => {
    const out = buildCalificacionFicha(fresca, 'jubilacion_mujer', 30, NOW);
    expect(out).toContain('CALIFICACIÓN PREVIA');
    expect(out).toContain('Jubilación Mujer');
    expect(out).toContain('61 años');
    expect(out).toContain('hace 5 días');
  });

  it('ignora una calificación vencida (> TTL)', () => {
    const vieja = { jubilacion_mujer: { ...fresca.jubilacion_mujer, calificado_at: '2026-01-01T12:00:00.000Z' } };
    expect(buildCalificacionFicha(vieja, 'jubilacion_mujer', 30, NOW)).toBe('');
  });

  it('sin calificación → string vacío', () => {
    expect(buildCalificacionFicha(null, null, 30, NOW)).toBe('');
    expect(buildCalificacionFicha({}, null, 30, NOW)).toBe('');
  });

  it('sin área del mensaje, renderiza todas las frescas', () => {
    const out = buildCalificacionFicha(fresca, null, 30, NOW);
    expect(out).toContain('Jubilación Mujer');
  });

  it('con área del mensaje, suprime las otras áreas presentes', () => {
    const dos = {
      ...fresca,
      laboral: { resultado: 'pago', datos: {}, calificado_at: '2026-06-29T12:00:00.000Z' },
    };
    const out = buildCalificacionFicha(dos, 'jubilacion_mujer', 30, NOW);
    expect(out).toContain('Jubilación Mujer');
    expect(out).not.toContain('Laboral');
  });

  it('usa "día" singular cuando calificó hace 1 día', () => {
    const ayer = { jubilacion: { resultado: 'gratis', datos: {}, calificado_at: '2026-06-29T11:00:00.000Z' } };
    const out = buildCalificacionFicha(ayer, 'jubilacion', 30, NOW);
    expect(out).toContain('hace 1 día');
    expect(out).not.toContain('hace 1 días');
  });
});

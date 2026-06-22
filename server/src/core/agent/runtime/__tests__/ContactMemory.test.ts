import { describe, it, expect } from 'vitest';
import { mergeProfile, buildFichaText } from '../ContactMemory';

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

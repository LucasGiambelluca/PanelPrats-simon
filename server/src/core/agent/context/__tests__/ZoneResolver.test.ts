import { describe, it, expect } from 'vitest';
import { matchZone, DEFAULT_GAZETTEER, resolveOfficeName } from '../ZoneResolver';

describe('ZoneResolver — gazetteer determinístico (AMBA)', () => {
  it('"soy de Lanús" sugiere Quilmes (zona sur)', () => {
    const r = matchZone('soy de Lanús', DEFAULT_GAZETTEER);
    expect(r.oficina_sugerida).toBe('Quilmes');
    expect(r.confianza).toBe('alta');
    expect(r.necesita_aclaracion).toBe(false);
    expect(r.siempre_ofrecer_video).toBe(true);
  });

  it('"vivo en Ramos Mejía" sugiere Haedo (zona oeste)', () => {
    expect(matchZone('vivo en Ramos Mejía', DEFAULT_GAZETTEER).oficina_sugerida).toBe('Haedo');
  });

  it('"estoy en Caballito" sugiere CABA', () => {
    expect(matchZone('estoy en Caballito', DEFAULT_GAZETTEER).oficina_sugerida).toBe('CABA');
  });

  it('"soy de Quilmes" matchea directo', () => {
    expect(matchZone('soy de quilmes', DEFAULT_GAZETTEER).oficina_sugerida).toBe('Quilmes');
  });

  it('tolera acentos y mayúsculas ("BERNAL")', () => {
    expect(matchZone('BERNAL', DEFAULT_GAZETTEER).oficina_sugerida).toBe('Quilmes');
  });
});

describe('ZoneResolver — vago (no adivina, pregunta)', () => {
  it('"soy de provincia" pide aclaración', () => {
    const r = matchZone('soy de provincia de Buenos Aires', DEFAULT_GAZETTEER);
    expect(r.oficina_sugerida).toBeNull();
    expect(r.necesita_aclaracion).toBe(true);
    expect(r.pregunta_aclaracion).toBeTruthy();
  });

  it('"del conurbano" pide aclaración', () => {
    expect(matchZone('soy del conurbano', DEFAULT_GAZETTEER).necesita_aclaracion).toBe(true);
  });
});

describe('ZoneResolver — fuera de cobertura → videollamada', () => {
  it('"soy de Córdoba" ofrece video, sin oficina', () => {
    const r = matchZone('soy de Córdoba', DEFAULT_GAZETTEER);
    expect(r.oficina_sugerida).toBeNull();
    expect(r.necesita_aclaracion).toBe(false);
    expect(r.siempre_ofrecer_video).toBe(true);
  });

  it('"estoy en La Plata" ofrece video', () => {
    const r = matchZone('estoy en La Plata', DEFAULT_GAZETTEER);
    expect(r.oficina_sugerida).toBeNull();
    expect(r.necesita_aclaracion).toBe(false);
  });
});

describe('ZoneResolver — sin señal', () => {
  it('texto sin localidad pide aclaración', () => {
    const r = matchZone('hola buenas necesito un turno', DEFAULT_GAZETTEER);
    expect(r.oficina_sugerida).toBeNull();
    expect(r.necesita_aclaracion).toBe(true);
  });
});

describe('resolveOfficeName — zona lógica → agenda real', () => {
  // Las agendas presenciales se llaman por profesional; el router devuelve la zona.
  const offices = [
    { nombre: 'DANIELA CANISSA', modalidad: 'video' },
    { nombre: 'DAIANA CABA', modalidad: 'ambas' },
    { nombre: 'MAURA HAEDO', modalidad: 'ambas' },
    { nombre: 'SERENA QUILMES', modalidad: 'ambas' },
  ];

  it('Quilmes → SERENA QUILMES', () => {
    expect(resolveOfficeName('Quilmes', offices)).toBe('SERENA QUILMES');
  });
  it('CABA → DAIANA CABA', () => {
    expect(resolveOfficeName('CABA', offices)).toBe('DAIANA CABA');
  });
  it('Haedo → MAURA HAEDO', () => {
    expect(resolveOfficeName('Haedo', offices)).toBe('MAURA HAEDO');
  });
  it('nunca resuelve a una agenda solo-video', () => {
    const soloVideo = [{ nombre: 'CANISSA CABA', modalidad: 'video' }];
    expect(resolveOfficeName('CABA', soloVideo)).toBeNull();
  });
  it('zona sin agenda presencial → null (el flujo ofrece video)', () => {
    expect(resolveOfficeName('Rosario', offices)).toBeNull();
  });
  it('si el nombre ya coincide exacto, lo usa tal cual', () => {
    const exact = [{ nombre: 'Quilmes', modalidad: 'presencial' }];
    expect(resolveOfficeName('Quilmes', exact)).toBe('Quilmes');
  });
  it('token exacto, no substring parcial (evita falsos positivos)', () => {
    // "caba" no debe pegar dentro de "cabana" (nombre inventado)
    const tricky = [{ nombre: 'CABANA SUR', modalidad: 'ambas' }];
    expect(resolveOfficeName('CABA', tricky)).toBeNull();
  });
});

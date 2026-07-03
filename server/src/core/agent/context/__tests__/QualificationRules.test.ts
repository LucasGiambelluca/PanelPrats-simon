import { describe, it, expect } from 'vitest';
import { validateQualification, hasCalificacionVigente, pickVigenteCalificacion } from '../QualificationRules';

describe('validateQualification — libreto jubilación', () => {
  const H = 'jubilacion_hombre', M = 'jubilacion_mujer';

  it('hombre 62 gratis SIN insalubres → rechazado', () => {
    const r = validateQualification(H, 'gratis', { edad: 62, nacionalidad: 'argentino' });
    expect(r.ok).toBe(false);
    expect((r as any).error).toMatch(/insalubre/i);
  });
  it('hombre 62 gratis CON insalubres y argentino → ok', () => {
    expect(validateQualification(H, 'gratis', { edad: 62, insalubres: true, nacionalidad: 'argentino' }).ok).toBe(true);
  });
  it('hombre 64 gratis sin nacionalidad → rechazado', () => {
    expect(validateQualification(H, 'gratis', { edad: 64 }).ok).toBe(false);
  });
  it('hombre extranjero ingreso 2010 gratis → rechazado', () => {
    expect(validateQualification(H, 'gratis', { edad: 65, nacionalidad: 'extranjero', anio_ingreso: 2010 }).ok).toBe(false);
  });
  it('hombre extranjero ingreso 2007 gratis → ok', () => {
    expect(validateQualification(H, 'gratis', { edad: 65, nacionalidad: 'extranjero', anio_ingreso: 2007 }).ok).toBe(true);
  });
  it('sin edad → rechazado siempre', () => {
    expect(validateQualification(H, 'gratis', {}).ok).toBe(false);
    expect(validateQualification(M, 'gratis', {}).ok).toBe(false);
  });
  it('mujer 59 gratis → ok directo (58-59 califica)', () => {
    expect(validateQualification(M, 'gratis', { edad: 59 }).ok).toBe(true);
  });
  it('mujer 61 gratis sin aportes → rechazado (60-63 exige aportes)', () => {
    expect(validateQualification(M, 'gratis', { edad: 61 }).ok).toBe(false);
  });
  it('mujer 61 con 25 años de aportes gratis → ok', () => {
    expect(validateQualification(M, 'gratis', { edad: 61, aportes_aprox: 25 }).ok).toBe(true);
  });
  it('mujer 61 con 12 años de aportes gratis → rechazado (corresponde pago)', () => {
    expect(validateQualification(M, 'gratis', { edad: 61, aportes_aprox: 12 }).ok).toBe(false);
  });
  it('mujer 50 gratis → rechazado; pago → ok', () => {
    expect(validateQualification(M, 'gratis', { edad: 50 }).ok).toBe(false);
    expect(validateQualification(M, 'pago', { edad: 50 }).ok).toBe(true);
  });
  it('jubilacion genérica gratis → rechazado (falta derivar por género)', () => {
    expect(validateQualification('jubilacion', 'gratis', { edad: 70 }).ok).toBe(false);
  });
  it('otras áreas pasan sin validación dura', () => {
    expect(validateQualification('laboral', 'gratis', {}).ok).toBe(true);
    expect(validateQualification('transito', 'descartar', {}).ok).toBe(true);
  });
  it('mujer boundaries de aportes 19/20/21 (60-63)', () => {
    expect(validateQualification('jubilacion_mujer', 'gratis', { edad: 61, aportes_aprox: 19 }).ok).toBe(false);
    expect(validateQualification('jubilacion_mujer', 'gratis', { edad: 61, aportes_aprox: 20 }).ok).toBe(true);  // libreto ambiguo en 20 → hoy califica
    expect(validateQualification('jubilacion_mujer', 'gratis', { edad: 61, aportes_aprox: 21 }).ok).toBe(true);
  });
  it('mujer boundaries de edad 58/60/63/64', () => {
    expect(validateQualification('jubilacion_mujer', 'gratis', { edad: 58 }).ok).toBe(true);
    expect(validateQualification('jubilacion_mujer', 'gratis', { edad: 60 }).ok).toBe(false); // 60 sin aportes
    expect(validateQualification('jubilacion_mujer', 'gratis', { edad: 63, aportes_aprox: 25 }).ok).toBe(true);
    expect(validateQualification('jubilacion_mujer', 'gratis', { edad: 64 }).ok).toBe(true);
  });
  it('hombre boundary edad 63 (califica por edad, aún necesita nacionalidad)', () => {
    expect(validateQualification('jubilacion_hombre', 'gratis', { edad: 63 }).ok).toBe(false); // falta nacionalidad
    expect(validateQualification('jubilacion_hombre', 'gratis', { edad: 63, nacionalidad: 'argentino' }).ok).toBe(true);
  });
  it('insalubres como string "true" también vale', () => {
    expect(validateQualification('jubilacion_hombre', 'gratis', { edad: 55, insalubres: 'true', nacionalidad: 'argentino' }).ok).toBe(true);
  });
});

describe('hasCalificacionVigente', () => {
  const now = Date.parse('2026-07-02T12:00:00Z');
  it('vigente dentro del TTL', () => {
    const cal = { jubilacion_hombre: { resultado: 'gratis', datos: {}, calificado_at: '2026-07-01T12:00:00Z' } };
    expect(hasCalificacionVigente(cal, 'jubilacion_hombre', 30, now)).toBe(true);
    expect(hasCalificacionVigente(cal, 'jubilacion', 30, now)).toBe(true); // genérica acepta h/m
  });
  it('vencida o ausente → false', () => {
    const cal = { jubilacion_hombre: { resultado: 'gratis', datos: {}, calificado_at: '2026-05-01T12:00:00Z' } };
    expect(hasCalificacionVigente(cal, 'jubilacion_hombre', 30, now)).toBe(false);
    expect(hasCalificacionVigente(null, 'jubilacion_hombre', 30, now)).toBe(false);
    expect(hasCalificacionVigente({}, 'laboral', 30, now)).toBe(false);
  });
});

describe('pickVigenteCalificacion — solo el área actual y vigente', () => {
  const now = Date.parse('2026-07-02T12:00:00Z');
  const dias = (n: number) => new Date(now - n * 86_400_000).toISOString();

  it('multi-área: con area=laboral devuelve la laboral (no la jubilación pago vieja)', () => {
    const cal = {
      jubilacion_hombre: { resultado: 'pago', datos: { edad: 62 }, calificado_at: dias(5) },
      laboral: { resultado: 'gratis', datos: {}, calificado_at: dias(1) },
    };
    const r = pickVigenteCalificacion(cal, 'laboral', 30, now);
    expect(r?.area).toBe('laboral');
    expect(r?.entry.resultado).toBe('gratis');
  });

  it('area=jubilacion con la de jubilación vencida (40 días, ttl 30) → null', () => {
    const cal = { jubilacion_hombre: { resultado: 'pago', datos: {}, calificado_at: dias(40) } };
    expect(pickVigenteCalificacion(cal, 'jubilacion', 30, now)).toBeNull();
  });

  it('area=jubilacion vigente → devuelve hombre/mujer', () => {
    const cal = { jubilacion_mujer: { resultado: 'gratis', datos: { edad: 64 }, calificado_at: dias(2) } };
    const r = pickVigenteCalificacion(cal, 'jubilacion', 30, now);
    expect(r?.area).toBe('jubilacion_mujer');
  });

  it('area null o cal null → null', () => {
    expect(pickVigenteCalificacion(null, 'laboral', 30, now)).toBeNull();
    expect(pickVigenteCalificacion({ laboral: { resultado: 'gratis', calificado_at: dias(1) } }, null, 30, now)).toBeNull();
  });

  it('entrada sin resultado o sin calificado_at → se ignora', () => {
    expect(pickVigenteCalificacion({ laboral: { datos: {} } }, 'laboral', 30, now)).toBeNull();
    expect(pickVigenteCalificacion({ laboral: { resultado: 'gratis' } }, 'laboral', 30, now)).toBeNull();
  });
});

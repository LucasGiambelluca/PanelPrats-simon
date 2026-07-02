import { describe, it, expect } from 'vitest';
import { validateQualification, hasCalificacionVigente } from '../QualificationRules';

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

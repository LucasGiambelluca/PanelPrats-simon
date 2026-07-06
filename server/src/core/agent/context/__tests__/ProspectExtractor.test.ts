import { describe, it, expect } from 'vitest';
import { sanitizeProspect, shouldExtract, extractProspect } from '../ProspectExtractor';
import { detectArea as detectAreaOf } from '../AreaDetector';

describe('sanitizeProspect — saneadores', () => {
  it('mensaje rico completo → todos los slots saneados', () => {
    const raw = {
      nombre: ' Ana López ', edad: 63, genero: 'F', anios_aporte: 30,
      localidad: 'Quilmes', telefono: '11 5174 9871', modalidad: 'Presencial',
      area_texto: 'quiero jubilarme', urgencia: 'normal', mejor_horario: 'a la tarde', hijos: 2,
    };
    const r = sanitizeProspect(raw, 'soy Ana López, tengo 63 años...');
    expect(r.slots.nombre).toBe('Ana López');
    expect(r.slots.edad).toBe(63);
    expect(r.slots.genero).toBe('f');
    expect(r.slots.anios_aporte).toBe(30);
    expect(r.slots.zona).toBe('Quilmes');           // localidad → clave 'zona'
    expect(r.slots.telefono).toBe('541151749871');  // ajustar al normalizado REAL de validarTelefonoAR
    expect(r.slots.modalidad).toBe('presencial');
    expect(r.slots.hijos).toBe(2);
    expect(r.slots.urgencia).toBe('normal');
    expect(r.slots.mejor_horario).toBe('a la tarde');
  });

  it('valores fuera de rango o inválidos se DESCARTAN sin romper el resto', () => {
    const raw = { edad: 140, anios_aporte: 99, telefono: '123', genero: 'x', modalidad: 'telepatía', nombre: 'A' };
    const r = sanitizeProspect(raw, 'hola');
    expect(r.slots.edad).toBeUndefined();
    expect(r.slots.anios_aporte).toBeUndefined();
    expect(r.slots.telefono).toBeUndefined();
    expect(r.slots.genero).toBeUndefined();
    expect(r.slots.modalidad).toBeUndefined();
    expect(r.slots.nombre).toBeUndefined();
  });

  it('AreaDetector sobre el texto original PISA al modelo', () => {
    const r = sanitizeProspect({ area_texto: 'laboral' }, 'quiero jubilarme, tengo 63');
    expect(r.area).toMatch(/^jubilacion/);
  });

  it('area_texto del modelo solo se usa re-validado si el regex no detectó nada', () => {
    const r = sanitizeProspect({ area_texto: 'me despidieron del trabajo' }, 'hola buenas tardes');
    expect(r.area).toBe('laboral');
    const r2 = sanitizeProspect({ area_texto: 'quiero un préstamo' }, 'hola buenas tardes');
    expect(r2.area).toBeNull();
  });

  it('crudo no-objeto → resultado vacío, nunca throw', () => {
    expect(sanitizeProspect(null, 'x')).toEqual({ slots: {}, area: null });
    expect(sanitizeProspect('json roto', 'x')).toEqual({ slots: {}, area: null });
    expect(sanitizeProspect([1, 2], 'x')).toEqual({ slots: {}, area: null });
  });
});

describe('shouldExtract — cuándo corre la pasada profunda', () => {
  const NOW = '2026-07-06T15:00:00.000Z';
  it('primer mensaje (sin historial) → true aunque sea corto', () => {
    expect(shouldExtract({ text: 'hola quiero jubilarme', historyLength: 0, extractorLastAt: null, now: NOW })).toBe(true);
  });
  it('primer mensaje real (el entrante ya persistido → historial 1) → true', () => {
    expect(shouldExtract({ text: 'hola quiero jubilarme', historyLength: 1, extractorLastAt: null, now: NOW })).toBe(true);
  });
  it('mensaje ≥120 chars con historial → true', () => {
    expect(shouldExtract({ text: 'x'.repeat(120), historyLength: 8, extractorLastAt: null, now: NOW })).toBe(true);
  });
  it('mensaje corto con historial → false', () => {
    expect(shouldExtract({ text: 'a la tarde', historyLength: 8, extractorLastAt: null, now: NOW })).toBe(false);
  });
  it('tope 1/día: ya corrió hoy → false; corrió ayer → true', () => {
    expect(shouldExtract({ text: 'x'.repeat(200), historyLength: 2, extractorLastAt: '2026-07-06T09:00:00.000Z', now: NOW })).toBe(false);
    expect(shouldExtract({ text: 'x'.repeat(200), historyLength: 2, extractorLastAt: '2026-07-05T09:00:00.000Z', now: NOW })).toBe(true);
  });
});

describe('extractProspect — LLM mockeado', () => {
  it('mensaje rico → JSON del modelo saneado y con área', async () => {
    const ai = {
      complete: async () => JSON.stringify({
        nombre: 'Ana López', edad: 63, anios_aporte: 30, localidad: 'Quilmes',
        genero: 'f', area_texto: 'quiero jubilarme',
      }),
    };
    const r = await extractProspect(ai, { text: 'Hola soy Ana López, tengo 63 años, 30 de aportes, vivo en Quilmes, quiero jubilarme' });
    expect(r.slots).toMatchObject({ nombre: 'Ana López', edad: 63, anios_aporte: 30, zona: 'Quilmes', genero: 'f' });
    expect(r.area).toMatch(/^jubilacion/);
  });

  it('modelo devuelve basura no-JSON → slots vacíos, área solo del regex del texto', async () => {
    const ai = { complete: async () => 'no puedo ayudarte con eso' };
    const r = await extractProspect(ai, { text: 'hola' });
    expect(r).toEqual({ slots: {}, area: detectAreaOf('hola') });
  });

  it('IA tira excepción → vacío, sin throw', async () => {
    const ai = { complete: async () => { throw new Error('sin saldo'); } };
    const r = await extractProspect(ai, { text: 'hola' });
    expect(r).toEqual({ slots: {}, area: null });
  });

  it('markdown fences se limpian', async () => {
    const ai = { complete: async () => '```json\n{"edad": 70}\n```' };
    const r = await extractProspect(ai, { text: 'hola tengo setenta' });
    expect(r.slots.edad).toBe(70);
  });
});

import { describe, it, expect, vi } from 'vitest';
import { sanitizeFicha, buildReceptionFicha } from '../ReceptionFichaBuilder';

const ctx = { telefono: '5491122223333', modalidad: 'presencial' as const, zona: 'Quilmes' };

describe('ReceptionFichaBuilder.sanitizeFicha — nunca inventa', () => {
  it('coacciona edad a número o null', () => {
    expect(sanitizeFicha({ edad: '62' }, ctx).edad).toBe(62);
    expect(sanitizeFicha({ edad: 'no sé' }, ctx).edad).toBeNull();
    expect(sanitizeFicha({ edad: 200 }, ctx).edad).toBeNull(); // fuera de rango humano
  });

  it('DNI: solo dígitos válidos, sino null', () => {
    expect(sanitizeFicha({ dni: '20.345.678' }, ctx).dni).toBe('20345678');
    expect(sanitizeFicha({ dni: 'no lo tengo a mano' }, ctx).dni).toBeNull();
  });

  it('motivo fuera del enum → null (no inventa categoría)', () => {
    expect(sanitizeFicha({ motivo: 'jubilacion' }, ctx).motivo).toBe('jubilacion');
    expect(sanitizeFicha({ motivo: 'algo raro' }, ctx).motivo).toBeNull();
  });

  it('teléfono y modalidad SIEMPRE vienen del contexto, no del modelo', () => {
    const f = sanitizeFicha({ telefono: 'HACK', modalidad: 'video' }, ctx);
    expect(f.telefono).toBe('5491122223333');
    expect(f.modalidad).toBe('presencial');
  });

  it('campos ausentes quedan null, no undefined', () => {
    const f = sanitizeFicha({}, ctx);
    expect(f.nombre).toBeNull();
    expect(f.anios_aporte).toBeNull();
    expect(f.situacion_previsional).toBeNull();
    expect(f.resumen_ia).toBe('');
  });

  it('anios_aporte numérico y razonable', () => {
    expect(sanitizeFicha({ anios_aporte: '30' }, ctx).anios_aporte).toBe(30);
    expect(sanitizeFicha({ anios_aporte: 99 }, ctx).anios_aporte).toBeNull(); // >70 no es plausible
  });

  it('nacionalidad: solo argentino/extranjero, sino null (respaldo)', () => {
    expect(sanitizeFicha({ nacionalidad: 'extranjero' }, ctx).nacionalidad).toBe('extranjero');
    expect(sanitizeFicha({ nacionalidad: 'argentino' }, ctx).nacionalidad).toBe('argentino');
    expect(sanitizeFicha({ nacionalidad: 'peruano' }, ctx).nacionalidad).toBeNull();
    expect(sanitizeFicha({}, ctx).nacionalidad).toBeNull();
  });

  it('insalubres: true/false explícito o null (respaldo)', () => {
    expect(sanitizeFicha({ insalubres: true }, ctx).insalubres).toBe(true);
    expect(sanitizeFicha({ insalubres: 'true' }, ctx).insalubres).toBe(true);
    expect(sanitizeFicha({ insalubres: false }, ctx).insalubres).toBe(false);
    expect(sanitizeFicha({ insalubres: 'quizás' }, ctx).insalubres).toBeNull();
    expect(sanitizeFicha({}, ctx).insalubres).toBeNull();
  });
});

describe('ReceptionFichaBuilder.buildReceptionFicha — con IA inyectada', () => {
  it('arma la ficha desde la conversación y sanea la salida', async () => {
    const ai = {
      complete: vi.fn().mockResolvedValue(JSON.stringify({
        nombre: 'Juan', edad: 62, dni: '20345678', motivo: 'jubilacion',
        anios_aporte: 30, situacion_previsional: 'le faltan 2 años de aportes',
        resumen_ia: 'Juan, 62, 30 años de aportes. Quiere jubilarse, le faltan 2 años.',
      })),
    };
    const ficha = await buildReceptionFicha(ai, { conversation: 'Cliente: tengo 62...', ctx });
    expect(ai.complete).toHaveBeenCalled();
    expect(ficha.nombre).toBe('Juan');
    expect(ficha.edad).toBe(62);
    expect(ficha.motivo).toBe('jubilacion');
    expect(ficha.telefono).toBe('5491122223333');
    expect(ficha.resumen_ia).toContain('Juan');
  });

  it('si la IA falla, devuelve ficha vacía pero válida (telefono+modalidad)', async () => {
    const ai = { complete: vi.fn().mockRejectedValue(new Error('sin saldo')) };
    const ficha = await buildReceptionFicha(ai, { conversation: 'x', ctx });
    expect(ficha.telefono).toBe('5491122223333');
    expect(ficha.modalidad).toBe('presencial');
    expect(ficha.nombre).toBeNull();
    expect(ficha.resumen_ia).toBe('');
  });

  it('si la IA devuelve JSON basura, no rompe', async () => {
    const ai = { complete: vi.fn().mockResolvedValue('esto no es json') };
    const ficha = await buildReceptionFicha(ai, { conversation: 'x', ctx });
    expect(ficha.telefono).toBe('5491122223333');
    expect(ficha.nombre).toBeNull();
  });

  it('reenvía el modelo elegido (gpt-4o) a la IA', async () => {
    const ai = { complete: vi.fn().mockResolvedValue('{}') };
    await buildReceptionFicha(ai, { conversation: 'x', ctx, model: 'gpt-4o' });
    expect(ai.complete).toHaveBeenCalledWith(expect.objectContaining({ model: 'gpt-4o' }));
  });
});

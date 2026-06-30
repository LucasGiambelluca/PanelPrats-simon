import { describe, it, expect, vi } from 'vitest';
import {
  sanitizeIntent,
  classifyIntent,
  detectOptOut,
  type IntentResult,
} from '../IntentClassifier';

// ─── Constantes de fallback ────────────────────────────────────────────────────
const FALLBACK: IntentResult = {
  intent: 'otro',
  quiere_continuar: true,
  nivel_frustracion: 0,
  es_cierre: false,
  slots_detectados: {},
  confianza: 0,
};

// ─── sanitizeIntent ────────────────────────────────────────────────────────────
describe('sanitizeIntent — normaliza el crudo del modelo', () => {
  it('JSON válido completo → tipos correctos', () => {
    const raw = {
      intent: 'agendar',
      quiere_continuar: true,
      nivel_frustracion: 1,
      es_cierre: false,
      slots_detectados: { fecha: 'mañana', hora: '10:00' },
      confianza: 0.9,
    };
    const r = sanitizeIntent(raw);
    expect(r.intent).toBe('agendar');
    expect(r.quiere_continuar).toBe(true);
    expect(r.nivel_frustracion).toBe(1);
    expect(r.es_cierre).toBe(false);
    expect(r.slots_detectados).toEqual({ fecha: 'mañana', hora: '10:00' });
    expect(r.confianza).toBe(0.9);
  });

  it('null/undefined → fallback neutro sin throw', () => {
    expect(sanitizeIntent(null)).toEqual(FALLBACK);
    expect(sanitizeIntent(undefined)).toEqual(FALLBACK);
  });

  it('string basura → fallback neutro sin throw', () => {
    expect(sanitizeIntent('esto no es json')).toEqual(FALLBACK);
  });

  it('intent fuera del enum → "otro"', () => {
    expect(sanitizeIntent({ ...FALLBACK, intent: 'hackear' }).intent).toBe('otro');
    expect(sanitizeIntent({ ...FALLBACK, intent: 123 }).intent).toBe('otro');
    // intents removidos del enum antiguo también caen a 'otro'
    expect(sanitizeIntent({ ...FALLBACK, intent: 'afirmacion' }).intent).toBe('otro');
    expect(sanitizeIntent({ ...FALLBACK, intent: 'consulta' }).intent).toBe('otro');
  });

  it('nivel_frustracion fuera de rango → clamp 0..3', () => {
    expect(sanitizeIntent({ ...FALLBACK, nivel_frustracion: -5 }).nivel_frustracion).toBe(0);
    expect(sanitizeIntent({ ...FALLBACK, nivel_frustracion: 99 }).nivel_frustracion).toBe(3);
    expect(sanitizeIntent({ ...FALLBACK, nivel_frustracion: 2.7 }).nivel_frustracion).toBe(2); // trunca a entero
  });

  it('confianza fuera de rango → clamp 0..1', () => {
    expect(sanitizeIntent({ ...FALLBACK, confianza: -1 }).confianza).toBe(0);
    expect(sanitizeIntent({ ...FALLBACK, confianza: 5 }).confianza).toBe(1);
  });

  it('quiere_continuar y es_cierre → coerción booleana', () => {
    expect(sanitizeIntent({ ...FALLBACK, quiere_continuar: 1, es_cierre: 0 }).quiere_continuar).toBe(true);
    expect(sanitizeIntent({ ...FALLBACK, quiere_continuar: 0, es_cierre: 1 }).es_cierre).toBe(true);
  });

  it('slots_detectados no-objeto → {}', () => {
    expect(sanitizeIntent({ ...FALLBACK, slots_detectados: 'malo' }).slots_detectados).toEqual({});
    expect(sanitizeIntent({ ...FALLBACK, slots_detectados: [1, 2] }).slots_detectados).toEqual({});
    expect(sanitizeIntent({ ...FALLBACK, slots_detectados: null }).slots_detectados).toEqual({});
  });

  it('nivel_frustracion: 3 sale bien tipado', () => {
    const r = sanitizeIntent({ ...FALLBACK, intent: 'frustracion', nivel_frustracion: 3 });
    expect(r.nivel_frustracion).toBe(3);
  });

  it('todos los labels del enum son válidos', () => {
    const labels = [
      'saludo', 'agendar', 'consultar', 'responder_dato',
      'negacion', 'despedida', 'opt_out', 'off_topic', 'frustracion', 'otro',
    ];
    for (const label of labels) {
      expect(sanitizeIntent({ ...FALLBACK, intent: label }).intent).toBe(label);
    }
  });

  it('intent "responder_dato" con slots_detectados → pasan correctamente', () => {
    const r = sanitizeIntent({
      intent: 'responder_dato',
      quiere_continuar: true,
      nivel_frustracion: 0,
      es_cierre: false,
      slots_detectados: { nombre: 'María', dni: '28123456' },
      confianza: 0.92,
    });
    expect(r.intent).toBe('responder_dato');
    expect(r.slots_detectados).toEqual({ nombre: 'María', dni: '28123456' });
  });

  it('intent "saludo" es válido', () => {
    const r = sanitizeIntent({ ...FALLBACK, intent: 'saludo' });
    expect(r.intent).toBe('saludo');
  });
});

// ─── detectOptOut ──────────────────────────────────────────────────────────────
describe('detectOptOut — regex offline, sin LLM', () => {
  it('matchea "no me escriban mas"', () => expect(detectOptOut('no me escriban mas')).toBe(true));
  it('matchea "dejen de molestar"', () => expect(detectOptOut('dejen de molestar')).toBe(true));
  it('matchea "darme de baja"', () => expect(detectOptOut('quiero darme de baja')).toBe(true));
  it('matchea "STOP" mayúsculas', () => expect(detectOptOut('STOP')).toBe(true));
  it('matchea "no me molesten"', () => expect(detectOptOut('no me molesten')).toBe(true));
  it('matchea "no me contacten"', () => expect(detectOptOut('no me contacten')).toBe(true));
  it('matchea "dejen de escribir"', () => expect(detectOptOut('dejen de escribir')).toBe(true));
  it('matchea "cancelar suscripcion"', () => expect(detectOptOut('quiero cancelar suscripcion')).toBe(true));
  it('matchea "no quiero que me escriban"', () => expect(detectOptOut('no quiero que me escriban')).toBe(true));
  it('matchea "baja" standalone', () => expect(detectOptOut('baja')).toBe(true));
  it('matchea "no me escriban" (sin "mas")', () => expect(detectOptOut('no me escriban')).toBe(true));

  it('NO matchea "no, gracias"', () => expect(detectOptOut('no, gracias')).toBe(false));
  it('NO matchea "no quiero presencial"', () => expect(detectOptOut('no quiero presencial')).toBe(false));
  it('NO matchea "gracias por todo"', () => expect(detectOptOut('gracias por todo')).toBe(false));
  it('NO matchea "ok dale"', () => expect(detectOptOut('ok dale')).toBe(false));
});

// ─── classifyIntent ────────────────────────────────────────────────────────────
describe('classifyIntent — con ai mock', () => {
  it('respuesta JSON válida → resultado correcto', async () => {
    const payload: IntentResult = {
      intent: 'agendar',
      quiere_continuar: true,
      nivel_frustracion: 0,
      es_cierre: false,
      slots_detectados: { fecha: 'mañana' },
      confianza: 0.95,
    };
    const ai = { complete: vi.fn().mockResolvedValue(JSON.stringify(payload)) };
    const r = await classifyIntent(ai, { text: 'quiero sacar un turno para mañana' });
    expect(r.intent).toBe('agendar');
    expect(r.confianza).toBe(0.95);
  });

  it('JSON malformado → fallback neutro, NO throw', async () => {
    const ai = { complete: vi.fn().mockResolvedValue('esto definitivamente no es json {{{') };
    const r = await classifyIntent(ai, { text: 'algo' });
    expect(r).toEqual(FALLBACK);
  });

  it('ai.complete lanza error (reject) → fallback neutro, NO throw', async () => {
    const ai = { complete: vi.fn().mockRejectedValue(new Error('timeout')) };
    const r = await classifyIntent(ai, { text: 'algo' });
    expect(r).toEqual(FALLBACK);
  });

  it('refuerzo: modelo dice "consultar" pero texto tiene opt-out → fuerza opt_out', async () => {
    const payload: IntentResult = {
      intent: 'consultar',
      quiere_continuar: true,
      nivel_frustracion: 0,
      es_cierre: false,
      slots_detectados: {},
      confianza: 0.8,
    };
    const ai = { complete: vi.fn().mockResolvedValue(JSON.stringify(payload)) };
    const r = await classifyIntent(ai, { text: 'no me escriban mas' });
    expect(r.intent).toBe('opt_out');
    expect(r.quiere_continuar).toBe(false);
    expect(r.es_cierre).toBe(true);
  });

  it('reenvía apiKey y model al ai.complete', async () => {
    const ai = { complete: vi.fn().mockResolvedValue('{}') };
    await classifyIntent(ai, { text: 'hola', apiKey: 'sk-test', model: 'gpt-4o' });
    expect(ai.complete).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'sk-test', model: 'gpt-4o' }));
  });

  it('nivel_frustracion: 3 del modelo sale bien tipado', async () => {
    const payload = {
      intent: 'frustracion',
      quiere_continuar: true,
      nivel_frustracion: 3,
      es_cierre: false,
      slots_detectados: {},
      confianza: 0.85,
    };
    const ai = { complete: vi.fn().mockResolvedValue(JSON.stringify(payload)) };
    const r = await classifyIntent(ai, { text: 'esto es un asco, nadie me ayuda' });
    expect(r.nivel_frustracion).toBe(3);
    expect(r.intent).toBe('frustracion');
  });

  it('respuesta con markdown code fence → parsea igual', async () => {
    const payload = {
      intent: 'consultar',
      quiere_continuar: true,
      nivel_frustracion: 0,
      es_cierre: false,
      slots_detectados: {},
      confianza: 0.7,
    };
    const ai = { complete: vi.fn().mockResolvedValue('```json\n' + JSON.stringify(payload) + '\n```') };
    const r = await classifyIntent(ai, { text: '¿cuánto cuesta?' });
    expect(r.intent).toBe('consultar');
  });

  it('intent "saludo" llega bien del modelo', async () => {
    const payload: IntentResult = {
      intent: 'saludo',
      quiere_continuar: true,
      nivel_frustracion: 0,
      es_cierre: false,
      slots_detectados: {},
      confianza: 0.99,
    };
    const ai = { complete: vi.fn().mockResolvedValue(JSON.stringify(payload)) };
    const r = await classifyIntent(ai, { text: 'hola! buenos días' });
    expect(r.intent).toBe('saludo');
  });

  it('intent "responder_dato" con slots llega bien del modelo', async () => {
    const payload: IntentResult = {
      intent: 'responder_dato',
      quiere_continuar: true,
      nivel_frustracion: 0,
      es_cierre: false,
      slots_detectados: { nombre: 'Carlos', edad: '58' },
      confianza: 0.88,
    };
    const ai = { complete: vi.fn().mockResolvedValue(JSON.stringify(payload)) };
    const r = await classifyIntent(ai, { text: 'me llamo Carlos, tengo 58 años' });
    expect(r.intent).toBe('responder_dato');
    expect(r.slots_detectados).toEqual({ nombre: 'Carlos', edad: '58' });
  });
});

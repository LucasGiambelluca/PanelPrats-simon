import { describe, it, expect } from 'vitest';
import { resolveOption, type OfferedOption } from '../OptionResolver';

// 3 horarios ofrecidos (como los devolvería check_availability, ya formateados).
const slots: OfferedOption[] = [
  { index: 1, label: 'mié 02/07 09:00 hs', value: '2026-07-02T12:00:00.000Z' },
  { index: 2, label: 'mié 02/07 11:00 hs', value: '2026-07-02T14:00:00.000Z' },
  { index: 3, label: 'jue 03/07 15:00 hs', value: '2026-07-03T18:00:00.000Z' },
];

// Oficinas ofrecidas (como list_offices).
const offices: OfferedOption[] = [
  { index: 1, label: 'CABA — presencial', value: 'CABA' },
  { index: 2, label: 'Quilmes — presencial', value: 'Quilmes' },
  { index: 3, label: 'Videollamada', value: 'Videollamada' },
];

describe('OptionResolver — ordinales (habla de adulto mayor)', () => {
  it('"el tercero" toma la opción 3', () => {
    const r = resolveOption({ userText: 'el tercero', offered: slots });
    expect(r.matchedValue).toBe(slots[2].value);
    expect(r.confianza).toBeGreaterThan(0.8);
  });

  it('"deme el primero" toma la opción 1', () => {
    expect(resolveOption({ userText: 'deme el primero', offered: slots }).matchedValue).toBe(slots[0].value);
  });

  it('"el último" toma la última', () => {
    expect(resolveOption({ userText: 'el último', offered: slots }).matchedValue).toBe(slots[2].value);
  });

  it('"el del medio" con 3 opciones toma la 2', () => {
    expect(resolveOption({ userText: 'el del medio', offered: slots }).matchedValue).toBe(slots[1].value);
  });

  it('"el segundo no, mejor el primero" (corrección) toma el primero', () => {
    expect(resolveOption({ userText: 'el segundo no, mejor el primero', offered: slots }).matchedValue).toBe(slots[0].value);
  });
});

describe('OptionResolver — posicionales', () => {
  it('"la opción 2" toma la 2', () => {
    expect(resolveOption({ userText: 'la opción 2', offered: slots }).matchedValue).toBe(slots[1].value);
  });
  it('"el 3" toma la 3', () => {
    expect(resolveOption({ userText: 'el 3', offered: slots }).matchedValue).toBe(slots[2].value);
  });
  it('fuera de rango ("el 9") no resuelve', () => {
    expect(resolveOption({ userText: 'el 9', offered: slots }).matchedValue).toBeNull();
  });
});

describe('OptionResolver — semántico por modalidad/zona', () => {
  it('"el de videollamada" elige la opción de video', () => {
    expect(resolveOption({ userText: 'el de videollamada', offered: offices }).matchedValue).toBe('Videollamada');
  });
  it('"prefiero por video" elige video', () => {
    expect(resolveOption({ userText: 'prefiero hablar por video', offered: offices }).matchedValue).toBe('Videollamada');
  });
  it('"el de Quilmes" elige Quilmes', () => {
    expect(resolveOption({ userText: 'quiero el de Quilmes', offered: offices }).matchedValue).toBe('Quilmes');
  });
  it('"prefiero ir en persona" elige una presencial', () => {
    const r = resolveOption({ userText: 'prefiero ir en persona', offered: offices });
    expect(['CABA', 'Quilmes']).toContain(r.matchedValue);
  });
});

describe('OptionResolver — semántico por turno (mañana/tarde)', () => {
  it('"el de la mañana" elige un horario antes de las 13', () => {
    const r = resolveOption({ userText: 'mejor el de la mañana', offered: slots });
    expect([slots[0].value, slots[1].value]).toContain(r.matchedValue);
  });
  it('"a la tarde" elige un horario de la tarde', () => {
    expect(resolveOption({ userText: 'me viene mejor a la tarde', offered: slots }).matchedValue).toBe(slots[2].value);
  });
  it('"lo más temprano posible" elige el primero', () => {
    expect(resolveOption({ userText: 'lo más temprano posible', offered: slots }).matchedValue).toBe(slots[0].value);
  });
});

describe('OptionResolver — vago / aceptación', () => {
  it('"cualquiera está bien" elige uno (confianza media)', () => {
    const r = resolveOption({ userText: 'cualquiera está bien', offered: slots });
    expect(r.matchedValue).not.toBeNull();
    expect(r.confianza).toBeGreaterThan(0.4);
    expect(r.confianza).toBeLessThan(0.8);
  });
  it('"el que tenga más cerca" elige el primero', () => {
    expect(resolveOption({ userText: 'el que tenga más cerca', offered: slots }).matchedValue).toBe(slots[0].value);
  });
  it('"dale" con UNA sola opción la toma', () => {
    const one: OfferedOption[] = [{ index: 1, label: 'CABA', value: 'CABA' }];
    expect(resolveOption({ userText: 'dale', offered: one }).matchedValue).toBe('CABA');
  });
  it('"sí" con varias opciones NO adivina (ambiguo)', () => {
    expect(resolveOption({ userText: 'sí', offered: slots }).matchedValue).toBeNull();
  });
});

describe('OptionResolver — sin señal', () => {
  it('texto sin relación no resuelve', () => {
    expect(resolveOption({ userText: 'no sé, qué me conviene', offered: slots }).matchedValue).toBeNull();
  });
  it('lista vacía no resuelve', () => {
    expect(resolveOption({ userText: 'el primero', offered: [] }).matchedValue).toBeNull();
  });
});

describe('OptionResolver — hora en lenguaje natural', () => {
  const slots = [
    { index: 1, label: 'lun 29/06 10:30 hs', value: 'v1030' },
    { index: 2, label: 'lun 29/06 12:30 hs', value: 'v1230' },
    { index: 3, label: 'lun 29/06 16:00 hs', value: 'v1600' },
  ];
  it('"a las 10 está bien" → el de 10:30 (más cercano)', () => {
    expect(resolveOption({ userText: 'a las 10 está bien', offered: slots }).matchedValue).toBe('v1030');
  });
  it('"el del mediodía" → 12:30', () => {
    expect(resolveOption({ userText: 'el del mediodía', offered: slots }).matchedValue).toBe('v1230');
  });
  it('"a las 16" → 16:00', () => {
    expect(resolveOption({ userText: 'a las 16', offered: slots }).matchedValue).toBe('v1600');
  });
  it('"a las 12:30" exacto → 12:30', () => {
    expect(resolveOption({ userText: 'a las 12:30', offered: slots }).matchedValue).toBe('v1230');
  });
  it('"el de las 16:00 está perfecto" → 16:00', () => {
    expect(resolveOption({ userText: 'el de las 16:00 está perfecto', offered: slots }).matchedValue).toBe('v1600');
  });
});

describe('formatos de hora del libreto', () => {
  const offered = [
    { index: 1, label: 'vie 03/07 16:30', value: '2026-07-03T19:30:00.000Z' },
    { index: 2, label: 'lun 06/07 11:00', value: '2026-07-06T14:00:00.000Z' },
    { index: 3, label: 'lun 06/07 13:20', value: '2026-07-06T16:20:00.000Z' },
  ];
  const pick = (t: string) => resolveOption({ userText: t, offered });

  it.each(['16.30', '16 30', '1630', 'alas 16.30', 'a las 16:30', '03-07 alas 16.30'])(
    'matchea "%s" → slot de 16:30', (t) => {
      expect(pick(t).matchedValue).toBe('2026-07-03T19:30:00.000Z');
    });

  it('hora explícita SIN match exacto → null (nunca adivinar otro slot)', () => {
    expect(pick('a las 15:00').matchedValue).toBeNull();
    expect(pick('14.45').matchedValue).toBeNull();
  });

  it('año no se confunde con hora', () => {
    expect(pick('llegué en 2008').matchedValue).toBeNull();
  });

  it('día nombrado con una sola opción ese día → la elige', () => {
    expect(pick('el viernes').matchedValue).toBe('2026-07-03T19:30:00.000Z');
    expect(pick('viernes 3').matchedValue).toBe('2026-07-03T19:30:00.000Z');
  });

  it('día + hora → matchea dentro del día', () => {
    expect(pick('el lunes a las 13').matchedValue).toBe('2026-07-06T16:20:00.000Z');
  });

  it('día con varias opciones y sin hora → null (que el caller repregunte)', () => {
    expect(pick('el lunes').matchedValue).toBeNull();
  });

  it('día NO ofrecido + hora coincidente → null (nunca cae en otro día)', () => {
    expect(pick('el sabado a las 16:30').matchedValue).toBeNull();
  });
});

describe('formatos de hora extra (fricción prod)', () => {
  const offered = [
    { index: 1, label: 'vie 10/07 14:10', value: '2026-07-10T17:10:00.000Z' },
    { index: 2, label: 'vie 10/07 14:40', value: '2026-07-10T17:40:00.000Z' },
    { index: 3, label: 'lun 06/07 15:30', value: '2026-07-06T18:30:00.000Z' },
  ];
  const pick = (t: string) => resolveOption({ userText: t, offered });
  it('"14 y 40" → 14:40', () => { expect(pick('14 y 40').matchedValue).toBe('2026-07-10T17:40:00.000Z'); });
  it('"a las 14 y media" → 14:30 (no ofrecido) → null', () => { expect(pick('a las 14 y media').matchedValue).toBeNull(); });
  it('"Viernes 14 10" → vie 14:10', () => { expect(pick('Viernes 14 10').matchedValue).toBe('2026-07-10T17:10:00.000Z'); });
  it('"el lunes 15 y 30" → lun 15:30', () => { expect(pick('el lunes 15 y 30').matchedValue).toBe('2026-07-06T18:30:00.000Z'); });
  it('hora sin match exacto sigue devolviendo null', () => { expect(pick('a las 20').matchedValue).toBeNull(); });
  it('no rompe: "tengo 3 hijos" no matchea horario', () => { expect(pick('tengo 3 hijos').matchedValue).toBeNull(); });
});

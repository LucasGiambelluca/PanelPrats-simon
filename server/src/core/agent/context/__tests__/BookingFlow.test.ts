import { describe, it, expect, vi } from 'vitest';
import { startBooking, advanceBooking, detectBookingIntent, type BookingDeps } from '../BookingFlow';

const SLOTS = [
  { start: '2026-07-02T12:00:00.000Z', end: '2026-07-02T12:30:00.000Z', profileId: 'p1', oficina: 'Quilmes' }, // 09:00 local
  { start: '2026-07-02T14:00:00.000Z', end: '2026-07-02T14:30:00.000Z', profileId: 'p1', oficina: 'Quilmes' }, // 11:00 local
  { start: '2026-07-02T19:00:00.000Z', end: '2026-07-02T19:30:00.000Z', profileId: 'p2', oficina: 'Quilmes' }, // 16:00 local
];

const deaccent = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

function makeDeps(over: Partial<BookingDeps> = {}): BookingDeps {
  return {
    suggestOffice: vi.fn(async (raw: string) => {
      const t = deaccent(raw); // el ZoneResolver real normaliza acentos
      return /lanus|quilmes|bernal/.test(t)
        ? { oficina_sugerida: 'Quilmes', necesita_aclaracion: false }
        : /cordoba|plata/.test(t)
        ? { oficina_sugerida: null, necesita_aclaracion: false } // fuera de cobertura
        : { oficina_sugerida: null, necesita_aclaracion: true, pregunta_aclaracion: '¿En qué zona o localidad vive?' };
    }),
    videoOfficeName: vi.fn(async () => 'Videollamada'),
    defaultOffice: vi.fn(async () => 'Capital'),
    freeSlots: vi.fn(async () => SLOTS),
    book: vi.fn(async () => ({ direccion: 'Moreno 609', video_link: null, modalidad: 'presencial' })),
    ...over,
  };
}

describe('BookingFlow — camino feliz presencial con zona', () => {
  it('arranca presencial + Lanús → propone UNA oficina (Quilmes), 3 slots numerados', async () => {
    const deps = makeDeps();
    const r = await startBooking({ modalidad: 'presencial', zona: 'soy de Lanús' }, deps);
    expect(deps.suggestOffice).toHaveBeenCalled();
    expect(r.state.stage).toBe('await_slot');
    expect(r.state.oficina).toBe('Quilmes');   // interno
    expect(r.state.offered).toHaveLength(3);
    // De cara al cliente NO exponemos el nombre interno de la agenda; sí la modalidad.
    expect(r.messages.join(' ')).toMatch(/presencial/);
    expect(r.messages.join(' ')).not.toMatch(/Quilmes/);
    expect(r.active).toBe(true);
  });

  it('flujo completo: elige "el primero", da nombre → agenda DIRECTO (sin confirmar)', async () => {
    const deps = makeDeps();
    let { state } = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);

    let step = await advanceBooking(state, 'deme el primerito', deps);
    expect(step.state.stage).toBe('ask_name');           // resolvió slot, falta nombre
    expect(step.state.chosenStart).toBe(SLOTS[0].start);
    state = step.state;

    // Con el nombre ya agenda: NO hay turno de confirmación intermedio.
    step = await advanceBooking(state, 'mi nombre es Juan', deps);
    expect(step.state.nombre).toBe('Juan');
    expect(deps.book).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Juan', start: SLOTS[0].start, oficina: 'Quilmes', profileId: 'p1' }));
    expect(step.state.stage).toBe('done');
    expect(step.active).toBe(false);
    expect(step.messages.join(' ')).toMatch(/Juan/);
    expect(step.messages.join(' ')).toMatch(/Moreno 609/);   // dirección al agendar
    expect(step.messages.join(' ')).not.toMatch(/confirmo\?/i);
  });

  it('WhatsApp (needsPhone=false): NO pide teléfono, agenda directo', async () => {
    const deps = makeDeps();
    let { state } = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);
    let step = await advanceBooking(state, 'el primero', deps);   // → ask_name
    step = await advanceBooking(step.state, 'Juan Pérez', deps);  // nombre → agenda directo
    expect(step.state.stage).toBe('done');
    expect(deps.book).toHaveBeenCalledOnce();
  });
});

describe('apego al libreto', () => {
  it('slot elegido + nombre → agenda DIRECTO, sin "¿Confirmo? (sí/no)"', async () => {
    const deps = makeDeps();
    let { state } = await startBooking({ modalidad: 'presencial', zona: 'Lanús', nombre: 'Juan' }, deps);
    const r = await advanceBooking(state, 'el primero', deps);
    expect(deps.book).toHaveBeenCalledOnce();
    expect(r.state.stage).toBe('done');
    expect(r.active).toBe(false);
    expect(r.messages[0]).not.toMatch(/confirmo\?/i);
    expect(r.messages[0]).toMatch(/queda agendad/i);
  });

  it('ningún mensaje del flujo contiene emojis ni voseo básico', async () => {
    const deps = makeDeps();
    const flows: string[] = [];
    let s = await startBooking({}, deps); flows.push(...s.messages);
    let a = await advanceBooking(s.state, 'presencial', deps); flows.push(...a.messages);
    a = await advanceBooking(a.state, 'no sé la zona', deps); flows.push(...a.messages);
    for (const m of flows) {
      expect(m, m).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u);
      expect(m, m).not.toMatch(/\b(decime|pasámelo|pasamelo|confirmame|preferís|preferis|sos|querés|queres|elegí|tenés|tenes)\b/i);
    }
  });

  it('no repite la misma plantilla: 2 fallos seguidos → mensajes distintos', async () => {
    const deps = makeDeps();
    const s = await startBooking({ modalidad: 'video' }, deps);
    const r1 = await advanceBooking(s.state, 'zzz no entiendo', deps);
    const r2 = await advanceBooking(r1.state, 'qqq tampoco', deps);
    expect(r1.messages[0]).not.toBe(r2.messages[0]);
  });

  it('nombre placeholder ("Cliente") NO se acepta como nombre', async () => {
    const deps = makeDeps();
    const r = await startBooking({ nombre: 'Cliente', modalidad: 'video' }, deps);
    expect(r.state.nombre).toBeUndefined();
  });

  it('nombre placeholder con puntuación ("Sr.") tampoco se acepta', async () => {
    const deps = makeDeps();
    const r = await startBooking({ nombre: 'Sr.', modalidad: 'video' }, deps);
    expect(r.state.nombre).toBeUndefined();
  });

  it('teléfono pasado en start_booking se hereda', async () => {
    const deps = makeDeps();
    const r = await startBooking({ modalidad: 'video', nombre: 'Ana', telefono: '541134567890', needsPhone: true }, deps);
    expect(r.state.telefono).toBe('541134567890');
  });

  it('ask_phone en FB/IG con "este mismo" pide un número real', async () => {
    const deps = makeDeps();
    const state = { stage: 'ask_phone' as const, modalidad: 'video' as const, oficina: 'Videollamada', nombre: 'Ana', needsPhone: true, chosenStart: SLOTS[0].start, meta: { [SLOTS[0].start]: { end: SLOTS[0].end, oficina: 'Videollamada' } } };
    const r = await advanceBooking(state, 'este mismo', deps);
    expect(r.state.stage).toBe('ask_phone');
    expect(r.messages[0]).toMatch(/número/i);
  });

  it('presencial sin horarios → AVISA que pasa a videollamada (no cambia en silencio)', async () => {
    const freeSlots = vi.fn()
      .mockResolvedValueOnce([])                 // presencial: vacío
      .mockResolvedValue(SLOTS);                 // luego video
    const deps = makeDeps({ freeSlots });
    const r = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);
    expect(r.messages[0]).toMatch(/videollamada/i);
  });
});

describe('BookingFlow — FB/IG piden teléfono real (needsPhone)', () => {
  it('tras el nombre pide el número, lo valida y lo pasa a book()', async () => {
    const deps = makeDeps();
    let { state } = await startBooking({ modalidad: 'presencial', zona: 'Lanús', needsPhone: true }, deps);

    let step = await advanceBooking(state, 'el primero', deps);
    expect(step.state.stage).toBe('ask_name');

    step = await advanceBooking(step.state, 'Juan Pérez', deps);
    // Con needsPhone NO confirma todavía: pide el teléfono.
    expect(step.state.stage).toBe('ask_phone');
    expect(step.messages.join(' ')).toMatch(/n[úu]mero/i);

    // Número inválido → repregunta, sigue en ask_phone.
    step = await advanceBooking(step.state, 'no sé', deps);
    expect(step.state.stage).toBe('ask_phone');

    // Número válido → agenda DIRECTO con el teléfono normalizado (sin confirmar).
    step = await advanceBooking(step.state, '11 2345-6789', deps);
    expect(deps.book).toHaveBeenCalledWith(expect.objectContaining({ telefono: '541123456789' }));
    expect(step.state.stage).toBe('done');
    expect(step.state.telefono).toBe('541123456789');
  });
});

describe('BookingFlow — modalidad y zona', () => {
  it('video → usa la oficina de videollamada directo', async () => {
    const deps = makeDeps();
    const r = await startBooking({ modalidad: 'video' }, deps);
    expect(r.state.oficina).toBe('Videollamada');
    expect(r.state.stage).toBe('await_slot');
  });

  it('sin modalidad → pregunta presencial o video', async () => {
    const r = await startBooking({}, makeDeps());
    expect(r.state.stage).toBe('ask_modality');
    expect(r.messages.join(' ').toLowerCase()).toMatch(/presencial|videollamada/);
  });

  it('presencial sin zona → pregunta la zona', async () => {
    const r = await startBooking({ modalidad: 'presencial' }, makeDeps());
    expect(r.state.stage).toBe('ask_zone');
  });

  it('zona fuera de cobertura → ofrece VIDEOLLAMADA (otra provincia/lejos → video, libreto)', async () => {
    const deps = makeDeps();
    const start = await startBooking({ modalidad: 'presencial' }, deps);
    const step = await advanceBooking(start.state, 'soy de Córdoba', deps);
    expect(step.state.oficina).toBe('Videollamada');  // video, NO la sede presencial lejana
    expect(step.state.modalidad).toBe('video');
    expect(step.state.stage).toBe('await_slot');
    expect(step.messages.join(' ')).toMatch(/no tenemos sede|videollamada/i);
  });

  it('fuera de cobertura SIN oficina de video → recién ahí, sede presencial por defecto', async () => {
    const deps = makeDeps({ videoOfficeName: vi.fn(async () => null) });
    const start = await startBooking({ modalidad: 'presencial' }, deps);
    const step = await advanceBooking(start.state, 'soy de Córdoba', deps);
    expect(step.state.modalidad).toBe('presencial');
    expect(step.state.oficina).toBe('Capital');
    expect(step.state.stage).toBe('await_slot');
  });
});

describe('BookingFlow — robustez', () => {
  it('en await_slot, respuesta ambigua NO inventa: re-pregunta', async () => {
    const deps = makeDeps();
    const start = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);
    const step = await advanceBooking(start.state, 'mmm no sé', deps);
    expect(step.state.stage).toBe('await_slot');     // sigue esperando
    expect(deps.book).not.toHaveBeenCalled();
  });

  it('legacy confirm (estados viejos en Redis): "no" re-ofrece sin agendar; "sí" agenda', async () => {
    const deps = makeDeps();
    const offered = SLOTS.map((s, i) => ({ index: i + 1, label: s.start, value: s.start }));
    const meta = Object.fromEntries(SLOTS.map((s) => [s.start, { end: s.end, oficina: 'Quilmes', profileId: s.profileId }]));
    const base = { stage: 'confirm' as const, modalidad: 'presencial' as const, oficina: 'Quilmes', nombre: 'Maria', chosenStart: SLOTS[1].start, offered, meta };
    const no = await advanceBooking(base, 'no, mejor otro', deps);
    expect(no.state.stage).toBe('await_slot');
    expect(deps.book).not.toHaveBeenCalled();
    const yes = await advanceBooking(base, 'sí, dale', deps);
    expect(deps.book).toHaveBeenCalledOnce();
    expect(yes.state.stage).toBe('done');
  });

  it('sin horarios disponibles → no rompe, ofrece alternativa', async () => {
    const deps = makeDeps({ freeSlots: vi.fn(async () => []) });
    const r = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);
    expect(r.state.stage).not.toBe('done');
    expect(r.messages.join(' ')).toMatch(/horario|video/i);
  });

  it('"el de la mañana" elige un slot de la mañana', async () => {
    const deps = makeDeps();
    const start = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);
    const step = await advanceBooking(start.state, 'el de la mañana', deps);
    expect(step.state.chosenStart).toBeTruthy();
    expect([SLOTS[0].start, SLOTS[1].start]).toContain(step.state.chosenStart);
  });
});

describe('detectBookingIntent — dispara el flujo sin depender del LLM', () => {
  it('"necesito un turno por mi jubilación, en persona" → start presencial', () => {
    const r = detectBookingIntent('necesito un turno por mi jubilación, prefiero ir en persona');
    expect(r.start).toBe(true);
    expect(r.modalidad).toBe('presencial');
  });
  it('"quiero que me atiendan por videollamada" → start video', () => {
    const r = detectBookingIntent('quiero que me atiendan por videollamada');
    expect(r.start).toBe(true);
    expect(r.modalidad).toBe('video');
  });
  it('"me das una cita?" → start', () => {
    expect(detectBookingIntent('me das una cita?').start).toBe(true);
  });
  it('"quiero CANCELAR mi turno" → NO start (no es nuevo)', () => {
    expect(detectBookingIntent('quiero cancelar mi turno').start).toBe(false);
  });
  it('"cuánto sale la consulta?" → NO start (es una pregunta)', () => {
    expect(detectBookingIntent('cuánto sale la consulta?').start).toBe(false);
  });
  it('"hola buenas" → NO start', () => {
    expect(detectBookingIntent('hola buenas').start).toBe(false);
  });
});

import { parseSlotRequest } from '../BookingFlow';

describe('parseSlotRequest — pedir otro día/horario (determinístico)', () => {
  const sunday = new Date('2026-06-28T12:00:00'); // domingo (getDay()=0)
  it('"el martes a la tarde" → día martes + turno tarde', () => {
    const r = parseSlotRequest('no tenes para el martes a la tarde?', sunday);
    expect(r.isRequest).toBe(true);
    expect(r.turno).toBe('tarde');
    expect(r.desde?.getDay()).toBe(2); // martes
  });
  it('"el de la mañana" → turno mañana, NO un día', () => {
    const r = parseSlotRequest('el de la mañana', sunday);
    expect(r.turno).toBe('manana');
    expect(r.desde).toBeUndefined();
  });
  it('"para mañana" → día siguiente, sin turno', () => {
    const r = parseSlotRequest('tenes para mañana?', sunday);
    expect(r.desde?.getDate()).toBe(29); // 28 + 1
    expect(r.turno).toBeUndefined();
  });
  it('"no sé" → no es un pedido', () => {
    expect(parseSlotRequest('no sé', sunday).isRequest).toBe(false);
  });
});

describe('parseSlotRequest minHour', () => {
  const now = new Date('2026-07-02T12:00:00Z');
  it('"después de las 3 y media" → minHour 15.5', () => {
    expect(parseSlotRequest('puedo después de las 3 y media', now).minHour).toBe(15.5);
  });
  it('"a partir de las 16" → 16', () => {
    expect(parseSlotRequest('a partir de las 16 hs', now).minHour).toBe(16);
  });
  it('"de 4 de la tarde en adelante" → 16', () => {
    expect(parseSlotRequest('de 4 de la tarde en adelante', now).minHour).toBe(16);
  });
  it('"a partir de las 15:30" → 15.5', () => {
    expect(parseSlotRequest('a partir de las 15:30', now).minHour).toBe(15.5);
  });
  it('"no antes de las 16" → 16', () => {
    expect(parseSlotRequest('no antes de las 16', now).minHour).toBe(16);
  });
  it('"pasado el mediodía" → 13', () => {
    expect(parseSlotRequest('recién pasado el mediodía', now).minHour).toBe(13);
  });
  it('sin restricción de hora → minHour undefined', () => {
    expect(parseSlotRequest('el martes', now).minHour).toBeUndefined();
  });
  it('minHour hace isRequest=true', () => {
    expect(parseSlotRequest('después de las 3 y media', now).isRequest).toBe(true);
  });
});

describe('BookingFlow — respeta la hora mínima pedida (Fix 1)', () => {
  // 09:00, 14:00 y 16:00 hora AR (UTC-3).
  const SLOTS_HH = [
    { start: '2026-07-02T12:00:00.000Z', end: '2026-07-02T12:30:00.000Z', profileId: 'p1', oficina: 'Quilmes' }, // 09:00
    { start: '2026-07-02T17:00:00.000Z', end: '2026-07-02T17:30:00.000Z', profileId: 'p1', oficina: 'Quilmes' }, // 14:00
    { start: '2026-07-02T19:00:00.000Z', end: '2026-07-02T19:30:00.000Z', profileId: 'p2', oficina: 'Quilmes' }, // 16:00
  ];
  const decAR = (iso: string) => ((new Date(iso).getUTCHours() - 3 + 24) % 24) + new Date(iso).getUTCMinutes() / 60;

  it('"después de las 15:30" → sólo ofrece slots ≥ 15:30', async () => {
    const deps = makeDeps({ freeSlots: vi.fn(async () => SLOTS_HH) });
    const start = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);
    const step = await advanceBooking(start.state, 'puedo recién después de las 15:30', deps);
    expect(step.state.stage).toBe('await_slot');
    const offered = (step.state.offered ?? []).map((o) => o.value);
    expect(offered.length).toBeGreaterThan(0);
    for (const v of offered) expect(decAR(v)).toBeGreaterThanOrEqual(15.5);
    expect(offered).toContain('2026-07-02T19:00:00.000Z'); // el de las 16:00
    expect(offered).not.toContain('2026-07-02T12:00:00.000Z'); // no el de 09:00
  });

  it('la restricción persiste: tras pedir hora mínima, "para el martes" sigue filtrando', async () => {
    const deps = makeDeps({ freeSlots: vi.fn(async () => SLOTS_HH) });
    const start = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);
    // "15:30" no coincide exacto con ningún slot ofrecido → re-busca y fija minHour.
    let step = await advanceBooking(start.state, 'a partir de las 15:30', deps);
    expect(step.state.minHour).toBe(15.5);
    step = await advanceBooking(step.state, 'mejor el martes', deps);
    const offered = (step.state.offered ?? []).map((o) => o.value);
    expect(offered.length).toBeGreaterThan(0);
    for (const v of offered) expect(decAR(v)).toBeGreaterThanOrEqual(15.5);
  });
});

describe('BookingFlow — await_slot re-busca otro día/turno', () => {
  it('"¿para el martes?" recarga slots (vuelve a llamar freeSlots) y sigue en await_slot', async () => {
    const deps = makeDeps();
    const start = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);
    (deps.freeSlots as any).mockClear();
    const step = await advanceBooking(start.state, '¿no tenés para el martes?', deps);
    expect(deps.freeSlots).toHaveBeenCalled();           // recargó
    expect(step.state.stage).toBe('await_slot');
    expect(deps.book).not.toHaveBeenCalled();
  });
});

describe('parseSlotRequest — "de tarde" (sin "la") y contexto de día', () => {
  const sun = new Date('2026-06-28T12:00:00');
  it('"de tarde seria mejor!" → turno tarde', () => {
    expect(parseSlotRequest('de tarde seria mejor!', sun).turno).toBe('tarde');
  });
  it('"de mañana" → turno mañana (no día)', () => {
    const r = parseSlotRequest('de mañana mejor', sun);
    expect(r.turno).toBe('manana');
    expect(r.desde).toBeUndefined();
  });
});

describe('BookingFlow — oferta diversa por franja (mañana/mediodía/tarde)', () => {
  it('con muchos slots de mañana + 1 de tarde, la oferta incluye el de tarde', async () => {
    const many = [
      { start: '2026-07-02T12:00:00.000Z', end: '2026-07-02T12:30:00.000Z', oficina: 'Q', profileId: 'p' }, // 09:00
      { start: '2026-07-02T12:30:00.000Z', end: '2026-07-02T13:00:00.000Z', oficina: 'Q', profileId: 'p' }, // 09:30
      { start: '2026-07-02T13:00:00.000Z', end: '2026-07-02T13:30:00.000Z', oficina: 'Q', profileId: 'p' }, // 10:00
      { start: '2026-07-02T16:00:00.000Z', end: '2026-07-02T16:30:00.000Z', oficina: 'Q', profileId: 'p' }, // 13:00 mediodía
      { start: '2026-07-02T20:00:00.000Z', end: '2026-07-02T20:30:00.000Z', oficina: 'Q', profileId: 'p' }, // 17:00 tarde
    ];
    const deps = makeDeps({ freeSlots: vi.fn(async () => many) });
    const r = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);
    const offered = (r.state.offered ?? []).map((o) => o.value);
    expect(offered).toContain('2026-07-02T20:00:00.000Z'); // tarde presente
    expect(offered).toContain('2026-07-02T16:00:00.000Z'); // mediodía presente
    expect(offered).toContain('2026-07-02T12:00:00.000Z'); // mañana presente
  });
});

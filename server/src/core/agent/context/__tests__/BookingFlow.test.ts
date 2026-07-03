import { describe, it, expect, vi } from 'vitest';
import { startBooking, startReschedule, advanceBooking, detectBookingIntent, detectRescheduleIntent, type BookingDeps } from '../BookingFlow';

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
      // En prod suggestOffice ya viene resuelto al nombre REAL de la agenda (resolveOfficeName).
      return /lanus|quilmes|bernal/.test(t)
        ? { oficina_sugerida: 'SERENA QUILMES', necesita_aclaracion: false }
        : /cordoba|plata/.test(t)
        ? { oficina_sugerida: null, necesita_aclaracion: false } // fuera de cobertura
        : { oficina_sugerida: null, necesita_aclaracion: true, pregunta_aclaracion: '¿En qué zona o localidad vive?' };
    }),
    videoOfficeName: vi.fn(async () => 'Videollamada'),
    defaultOffice: vi.fn(async () => 'Capital'),
    presencialOffices: vi.fn(async () => [
      { nombreInterno: 'DAIANA CABA', zona: 'CABA', direccion: 'Corrientes 1386, oficina 520' },
      { nombreInterno: 'SERENA QUILMES', zona: 'Quilmes', direccion: 'Moreno 609, oficina 1G' },
      { nombreInterno: 'MAURA HAEDO', zona: 'Haedo', direccion: 'Héroes de Malvinas Argentinas 35' },
    ]),
    freeSlots: vi.fn(async () => SLOTS),
    book: vi.fn(async () => ({ direccion: 'Moreno 609', video_link: null, modalidad: 'presencial' })),
    reschedule: vi.fn(async () => ({ direccion: null, video_link: null, modalidad: 'video' })),
    ...over,
  };
}

// El flujo nuevo (presencial primero) pasa por ask_office: pide zona → ofrece 3 sedes.
// Este helper llega al estado await_slot eligiendo la sede de Quilmes ('SERENA QUILMES';
// los SLOTS del mock traen oficina:'Quilmes', que es lo que se agenda finalmente).
async function reachSlots(deps: BookingDeps, over: { nombre?: string; needsPhone?: boolean; telefono?: string } = {}) {
  const s = await startBooking({ zona: 'Quilmes', ...over }, deps);
  return advanceBooking(s.state, 'la de Quilmes', deps);
}

describe('BookingFlow — camino feliz presencial con zona', () => {
  it('elegida la sede de Quilmes → propone 3 slots presencial (sin exponer nombre interno)', async () => {
    const deps = makeDeps();
    const r = await reachSlots(deps);
    expect(deps.suggestOffice).toHaveBeenCalled();
    expect(r.state.stage).toBe('await_slot');
    expect(r.state.oficina).toBe('SERENA QUILMES');   // interno (elegido en ask_office)
    expect(r.state.offered).toHaveLength(3);
    // El mensaje de slots muestra la modalidad, no el nombre interno de la agenda.
    expect(r.messages.join(' ')).toMatch(/presencial/);
    expect(r.messages.join(' ')).not.toMatch(/SERENA/);
    expect(r.active).toBe(true);
  });

  it('flujo completo: elige "el primero", da nombre → agenda DIRECTO (sin confirmar)', async () => {
    const deps = makeDeps();
    let { state } = await reachSlots(deps);

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
    let { state } = await reachSlots(deps);
    let step = await advanceBooking(state, 'el primero', deps);   // → ask_name
    step = await advanceBooking(step.state, 'Juan Pérez', deps);  // nombre → agenda directo
    expect(step.state.stage).toBe('done');
    expect(deps.book).toHaveBeenCalledOnce();
  });
});

describe('apego al libreto', () => {
  it('slot elegido + nombre → agenda DIRECTO, sin "¿Confirmo? (sí/no)"', async () => {
    const deps = makeDeps();
    let { state } = await reachSlots(deps, { nombre: 'Juan' });
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
    const r = await reachSlots(deps);
    expect(r.messages[0]).toMatch(/videollamada/i);
  });
});

describe('BookingFlow — FB/IG piden teléfono real (needsPhone)', () => {
  it('tras el nombre pide el número, lo valida y lo pasa a book()', async () => {
    const deps = makeDeps();
    let { state } = await reachSlots(deps, { needsPhone: true });

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

  it('sin modalidad → NO pregunta "presencial o video" neutral; pide la ZONA (libreto)', async () => {
    const r = await startBooking({}, makeDeps());
    expect(r.state.stage).toBe('ask_zone');
    expect(r.messages.join(' ').toLowerCase()).toMatch(/zona|localidad/);
    expect(r.messages.join(' ').toLowerCase()).not.toMatch(/videollamada/);
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
    const start = await reachSlots(deps);
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
    const r = await reachSlots(deps);
    expect(r.state.stage).not.toBe('done');
    expect(r.messages.join(' ')).toMatch(/horario|video/i);
  });

  it('"el de la mañana" elige un slot de la mañana', async () => {
    const deps = makeDeps();
    const start = await reachSlots(deps);
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

describe('reprogramación determinística', () => {
  it('startReschedule ofrece slots reales y al elegir REPROGRAMA (no book)', async () => {
    const deps = makeDeps();
    const s = await startReschedule({ apptId: 'appt-1', modalidad: 'video', oficina: 'DANIELA CANISSA', nombre: 'Ramona' }, deps);
    expect(s.state.stage).toBe('await_slot');
    expect(s.state.rescheduleApptId).toBe('appt-1');
    const r = await advanceBooking(s.state, 'el primero', deps);
    expect(deps.reschedule).toHaveBeenCalledOnce();
    expect(deps.book).not.toHaveBeenCalled();
    expect(r.state.stage).toBe('done');
    expect(r.active).toBe(false);
    expect(r.messages[0]).toMatch(/reprogramad/i);
    // el start que se reprograma es un slot REAL (2026, de SLOTS), nunca inventado por el LLM.
    const arg = (deps.reschedule as any).mock.calls[0][0];
    expect(arg.start).toBe(SLOTS[0].start);
    expect(arg.apptId).toBe('appt-1');
  });

  it('startReschedule sin oficina/modalidad → cae al flujo de zona preservando rescheduleApptId', async () => {
    const deps = makeDeps();
    const s = await startReschedule({ apptId: 'appt-9' }, deps);
    expect(s.state.stage).toBe('ask_zone');
    expect(s.state.rescheduleApptId).toBe('appt-9');
    // al avanzar por zona → sedes → elegir → REPROGRAMA (no agenda nuevo).
    const s2 = await advanceBooking(s.state, 'soy de Quilmes', deps);
    expect(s2.state.rescheduleApptId).toBe('appt-9');
    const s3 = await advanceBooking(s2.state, 'la de Quilmes', deps);
    expect(s3.state.stage).toBe('await_slot');
    const s4 = await advanceBooking(s3.state, 'el primero', deps);
    expect(deps.reschedule).toHaveBeenCalledOnce();
    expect(deps.book).not.toHaveBeenCalled();
  });

  it('detectRescheduleIntent reconoce pedidos de reprogramar', () => {
    expect(detectRescheduleIntent('quiero cambiar mi turno')).toBe(true);
    expect(detectRescheduleIntent('necesito reprogramar la cita')).toBe(true);
    expect(detectRescheduleIntent('quiero sacar un turno')).toBe(false); // eso es NUEVO
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
  // Guardas: números que NO son hora no deben volverse minHour (bloquearían la cita).
  it('"dentro de 15 días" (duración) → undefined', () => {
    expect(parseSlotRequest('¿tenés algo dentro de 15 días?', now).minHour).toBeUndefined();
  });
  it('"en un plazo de 20 días" (duración) → undefined', () => {
    expect(parseSlotRequest('lo necesito en un plazo de 20 días', now).minHour).toBeUndefined();
  });
  it('"antes de las 15" (techo, no piso) → undefined', () => {
    expect(parseSlotRequest('necesito algo antes de las 15', now).minHour).toBeUndefined();
  });
  it('"no puedo antes de las 4 de la tarde" (negación → piso) → 16', () => {
    expect(parseSlotRequest('no puedo antes de las 4 de la tarde', now).minHour).toBe(16);
  });
  it('"después de las 7 de la mañana" (AM veta el +12) → 7', () => {
    expect(parseSlotRequest('después de las 7 de la mañana', now).minHour).toBe(7);
  });
  it('"tengo 5 hijos" (cantidad) → undefined', () => {
    expect(parseSlotRequest('tengo 5 hijos y no puedo temprano', now).minHour).toBeUndefined();
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
    const start = await reachSlots(deps);
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
    const start = await reachSlots(deps);
    // "15:30" no coincide exacto con ningún slot ofrecido → re-busca y fija minHour.
    let step = await advanceBooking(start.state, 'a partir de las 15:30', deps);
    expect(step.state.minHour).toBe(15.5);
    step = await advanceBooking(step.state, 'mejor el martes', deps);
    const offered = (step.state.offered ?? []).map((o) => o.value);
    expect(offered.length).toBeGreaterThan(0);
    for (const v of offered) expect(decAR(v)).toBeGreaterThanOrEqual(15.5);
  });

  it('pedir "a la mañana" REEMPLAZA la cota vieja (no esconde las mañanas)', async () => {
    const deps = makeDeps({ freeSlots: vi.fn(async () => SLOTS_HH) });
    const start = await reachSlots(deps);
    let step = await advanceBooking(start.state, 'a partir de las 15:30', deps);
    expect(step.state.minHour).toBe(15.5);
    // Cambia de idea: ahora quiere mañana → la cota se descarta y ofrece slots <12.
    step = await advanceBooking(step.state, 'uf, mejor a la mañana', deps);
    expect(step.state.minHour).toBeUndefined();
    const offered = (step.state.offered ?? []).map((o) => o.value);
    expect(offered.length).toBeGreaterThan(0);
    for (const v of offered) expect(decAR(v)).toBeLessThan(12);
  });
});

describe('BookingFlow — await_slot re-busca otro día/turno', () => {
  it('"¿para el martes?" recarga slots (vuelve a llamar freeSlots) y sigue en await_slot', async () => {
    const deps = makeDeps();
    const start = await reachSlots(deps);
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
    const r = await reachSlots(deps);
    const offered = (r.state.offered ?? []).map((o) => o.value);
    expect(offered).toContain('2026-07-02T20:00:00.000Z'); // tarde presente
    expect(offered).toContain('2026-07-02T16:00:00.000Z'); // mediodía presente
    expect(offered).toContain('2026-07-02T12:00:00.000Z'); // mañana presente
  });
});

describe('Fix 2 — presencial primero (zona → cobertura → 3 sedes)', () => {
  it('cliente en cobertura → NO pregunta modalidad, pide zona y luego ofrece las 3 sedes', async () => {
    const deps = makeDeps();
    const r0 = await startBooking({}, deps);
    expect(r0.state.stage).toBe('ask_zone');
    expect(r0.messages[0]).toMatch(/zona|localidad/i);
    expect(r0.messages[0]).not.toMatch(/videollamada/i); // no pregunta modalidad neutral

    const r1 = await advanceBooking(r0.state, 'soy de Quilmes', deps);
    expect(r1.state.stage).toBe('ask_office');
    expect(r1.messages[0]).toMatch(/CABA/);
    expect(r1.messages[0]).toMatch(/Quilmes/);
    expect(r1.messages[0]).toMatch(/Haedo/);
    expect(r1.messages[0]).toMatch(/Moreno 609/);        // dirección de la sede
    expect(r1.messages[0]).toMatch(/videollamada/i);     // menciona video como alternativa
    expect(r1.messages[0]).not.toMatch(/SERENA|DAIANA|MAURA/); // nunca el nombre interno
  });

  it('elige una sede → carga slots presencial de esa oficina', async () => {
    const deps = makeDeps();
    const s = await advanceBooking((await startBooking({ zona: 'Quilmes' }, deps)).state, 'la de Quilmes', deps);
    expect(s.state.modalidad).toBe('presencial');
    expect(s.state.oficina).toBe('SERENA QUILMES');
    expect(s.state.stage).toBe('await_slot');
  });

  it('en ask_office elige videollamada → va a video', async () => {
    const deps = makeDeps();
    const r0 = await startBooking({ zona: 'Quilmes' }, deps);
    expect(r0.state.stage).toBe('ask_office');
    const r1 = await advanceBooking(r0.state, 'mejor por videollamada', deps);
    expect(r1.state.modalidad).toBe('video');
    expect(r1.state.oficina).toBe('Videollamada');
    expect(r1.state.stage).toBe('await_slot');
  });

  it('cliente pidió video explícito en start → respeta, no ofrece sedes', async () => {
    const deps = makeDeps();
    const r = await startBooking({ modalidad: 'video' }, deps);
    expect(r.state.modalidad).toBe('video');
    expect(r.state.stage).not.toBe('ask_office');
    expect(deps.presencialOffices).not.toHaveBeenCalled();
  });

  it('fuera de cobertura → videollamada directa (sin ofrecer sedes)', async () => {
    const deps = makeDeps();
    const r0 = await startBooking({}, deps);
    const r1 = await advanceBooking(r0.state, 'soy de Córdoba', deps);
    expect(r1.state.modalidad).toBe('video');
    expect(r1.state.stage).not.toBe('ask_office');
    expect(r1.state.stage).toBe('await_slot');
  });

  it('ningún mensaje con emoji ni voseo', async () => {
    const deps = makeDeps();
    const msgs: string[] = [];
    let s = await startBooking({}, deps); msgs.push(...s.messages);
    let a = await advanceBooking(s.state, 'quilmes', deps); msgs.push(...a.messages);
    for (const m of msgs) {
      expect(m, m).not.toMatch(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u);
      expect(m, m).not.toMatch(/\b(decime|preferís|sos|querés|elegí)\b/i);
    }
  });
});

describe('Fix 2 review — ask_office robusto (C1/C2/I3)', () => {
  it('C1/C2: "la más cercana" usa la sede SUGERIDA por la zona, no la primera (CABA)', async () => {
    const deps = makeDeps();
    const r0 = await startBooking({ zona: 'Quilmes' }, deps); // ask_office, sugerida Quilmes
    expect(r0.state.stage).toBe('ask_office');
    const r1 = await advanceBooking(r0.state, 'la más cercana', deps);
    expect(r1.state.modalidad).toBe('presencial');
    expect(r1.state.oficina).toBe('SERENA QUILMES');
    expect(r1.state.stage).toBe('await_slot');
  });

  it('C1/C2: "no sé" NO loopea → cae a la sede sugerida', async () => {
    const deps = makeDeps();
    const r0 = await startBooking({ zona: 'Quilmes' }, deps);
    const r1 = await advanceBooking(r0.state, 'no sé', deps);
    expect(r1.state.stage).toBe('await_slot');
    expect(r1.state.oficina).toBe('SERENA QUILMES');
  });

  it('C1/C2: "cualquiera" → sede sugerida (no CABA)', async () => {
    const deps = makeDeps();
    const r0 = await startBooking({ zona: 'Quilmes' }, deps);
    const r1 = await advanceBooking(r0.state, 'cualquiera', deps);
    expect(r1.state.oficina).toBe('SERENA QUILMES');
  });

  it('I3: "a las 4" en ask_office NO va a video; cae al default presencial sugerido', async () => {
    const deps = makeDeps();
    const r0 = await startBooking({ zona: 'Quilmes' }, deps);
    const r1 = await advanceBooking(r0.state, 'a las 4', deps);
    expect(r1.state.modalidad).toBe('presencial');
    expect(r1.state.oficina).toBe('SERENA QUILMES');
  });

  it('respeta la sede nombrada explícita (CABA) aunque la sugerida sea Quilmes', async () => {
    const deps = makeDeps();
    const r0 = await startBooking({ zona: 'Quilmes' }, deps);
    const r1 = await advanceBooking(r0.state, 'la de CABA', deps);
    expect(r1.state.oficina).toBe('DAIANA CABA');
  });

  it('sigue yendo a video si lo pide explícito en ask_office', async () => {
    const deps = makeDeps();
    const r0 = await startBooking({ zona: 'Quilmes' }, deps);
    const r1 = await advanceBooking(r0.state, 'mejor por videollamada', deps);
    expect(r1.state.modalidad).toBe('video');
  });
});

describe('Fix 2 review — I4 video en ask_zone', () => {
  it('en ask_zone "mejor por videollamada" → modalidad video (no repregunta zona)', async () => {
    const deps = makeDeps();
    const r0 = await startBooking({}, deps); // ask_zone
    expect(r0.state.stage).toBe('ask_zone');
    const r1 = await advanceBooking(r0.state, 'mejor por videollamada', deps);
    expect(r1.state.modalidad).toBe('video');
    expect(r1.state.stage).toBe('await_slot');
  });
});

describe('Fix 2 review — I5 nombre interno JAMÁS al cliente', () => {
  it('sede sin token de zona conocido → muestra dirección, nunca el nombre interno', async () => {
    const deps = makeDeps({
      presencialOffices: vi.fn(async () => [
        { nombreInterno: 'DANIELA CANISSA', zona: null, direccion: 'Calle Falsa 123' },
      ]),
    });
    const r0 = await startBooking({ zona: 'Quilmes' }, deps);
    expect(r0.state.stage).toBe('ask_office');
    expect(r0.messages[0]).not.toMatch(/DANIELA|CANISSA/i);
    expect(r0.messages[0]).not.toMatch(/\bnull\b/);
    expect(r0.messages[0]).toMatch(/Calle Falsa 123/);
  });

  it('sede sin zona NI dirección → genérico "nuestra oficina", nunca el nombre interno', async () => {
    const deps = makeDeps({
      presencialOffices: vi.fn(async () => [
        { nombreInterno: 'DANIELA CANISSA', zona: null, direccion: null },
      ]),
    });
    const r0 = await startBooking({ zona: 'Quilmes' }, deps);
    expect(r0.messages[0]).not.toMatch(/DANIELA|CANISSA/i);
    expect(r0.messages[0]).not.toMatch(/\bnull\b/);
    expect(r0.messages[0]).toMatch(/nuestra oficina/i);
  });
});

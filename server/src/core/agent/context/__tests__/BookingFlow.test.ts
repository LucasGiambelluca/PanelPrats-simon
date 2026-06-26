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
        : { oficina_sugerida: null, necesita_aclaracion: true, pregunta_aclaracion: '¿De qué zona sos?' };
    }),
    videoOfficeName: vi.fn(async () => 'Videollamada'),
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

  it('flujo completo: elige "el primero", da nombre, confirma → agenda', async () => {
    const deps = makeDeps();
    let { state } = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);

    let step = await advanceBooking(state, 'deme el primerito', deps);
    expect(step.state.stage).toBe('ask_name');           // resolvió slot, falta nombre
    expect(step.state.chosenStart).toBe(SLOTS[0].start);
    state = step.state;

    step = await advanceBooking(state, 'mi nombre es Juan', deps);
    expect(step.state.stage).toBe('confirm');
    expect(step.state.nombre).toBe('Juan');
    expect(step.messages.join(' ')).toMatch(/Juan/);
    state = step.state;

    step = await advanceBooking(state, 'sí, confirmo', deps);
    expect(deps.book).toHaveBeenCalledWith(expect.objectContaining({ nombre: 'Juan', start: SLOTS[0].start, oficina: 'Quilmes', profileId: 'p1' }));
    expect(step.state.stage).toBe('done');
    expect(step.active).toBe(false);
    expect(step.messages.join(' ')).toMatch(/Moreno 609/);   // dirección al confirmar
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

  it('zona fuera de cobertura → ofrece videollamada', async () => {
    const deps = makeDeps();
    const start = await startBooking({ modalidad: 'presencial' }, deps);
    const step = await advanceBooking(start.state, 'soy de Córdoba', deps);
    expect(step.state.oficina).toBe('Videollamada');
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

  it('en confirm, "no" vuelve a ofrecer los horarios', async () => {
    const deps = makeDeps();
    let { state } = await startBooking({ modalidad: 'presencial', zona: 'Lanús' }, deps);
    state = (await advanceBooking(state, 'el segundo', deps)).state;
    state = (await advanceBooking(state, 'Maria', deps)).state;
    const step = await advanceBooking(state, 'no, mejor otro', deps);
    expect(step.state.stage).toBe('await_slot');
    expect(deps.book).not.toHaveBeenCalled();
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

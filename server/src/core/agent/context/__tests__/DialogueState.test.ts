// ─── DialogueState Tests ─────────────────────────────────────────────────────
// TDD Fase 3: estado conversacional + slot-filling determinístico.
// Sin IA, sin red, sin reloj interno. Funciones puras 100% testeables.

import { describe, it, expect } from 'vitest';
import {
  createDialogueState,
  requiredSlots,
  ensureRequiredSlots,
  mergeSlots,
  nextPendingSlot,
  markAsked,
  isSlotStuck,
  stuckSlot,
  buildDatosAportados,
  slotsPrefill,
  type DialogueState,
} from '../DialogueState';

// ── createDialogueState ───────────────────────────────────────────────────────

describe('createDialogueState', () => {
  it('crea estado inicial correcto', () => {
    const s = createDialogueState();
    expect(s.fase).toBe('consulta');
    expect(s.area).toBeNull();
    expect(s.slots).toEqual({});
    expect(s.ultima_pregunta).toBeNull();
    expect(s.redirecciones_offtopic).toBe(0);
    expect(s.cerrada).toBe(false);
    expect(s.cierre_motivo).toBeNull();
  });
});

// ── requiredSlots ─────────────────────────────────────────────────────────────

describe('requiredSlots', () => {
  it('fase consulta → [] sin importar el area', () => {
    const s = createDialogueState(); // fase = 'consulta'
    expect(requiredSlots(s, null)).toEqual([]);
    expect(requiredSlots(s, 'jubilacion')).toEqual([]);
    expect(requiredSlots(s, 'laboral')).toEqual([]);
  });

  it('fase calificacion + jubilacion → [edad]', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'calificacion' };
    expect(requiredSlots(s, 'jubilacion')).toEqual(['edad']);
  });

  it('fase calificacion + jubilacion_hombre → [edad]', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'calificacion' };
    expect(requiredSlots(s, 'jubilacion_hombre')).toEqual(['edad']);
  });

  it('fase calificacion + jubilacion_mujer → [edad]', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'calificacion' };
    expect(requiredSlots(s, 'jubilacion_mujer')).toEqual(['edad']);
  });

  it('fase calificacion + area no-jubilacion → []', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'calificacion' };
    expect(requiredSlots(s, 'laboral')).toEqual([]);
    expect(requiredSlots(s, 'art')).toEqual([]);
    expect(requiredSlots(s, 'pension_viudez')).toEqual([]);
    expect(requiredSlots(s, 'transito')).toEqual([]);
    expect(requiredSlots(s, null)).toEqual([]);
  });

  it('fase agendado → [] (delegado a BookingFlow, no duplicar)', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'agendado' };
    expect(requiredSlots(s, 'jubilacion')).toEqual([]);
    expect(requiredSlots(s, 'jubilacion_mujer')).toEqual([]);
    expect(requiredSlots(s, null)).toEqual([]);
  });

  it('fase cerrada → []', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'cerrada' };
    expect(requiredSlots(s, 'jubilacion')).toEqual([]);
    expect(requiredSlots(s, null)).toEqual([]);
  });
});

// ── ensureRequiredSlots ───────────────────────────────────────────────────────

describe('ensureRequiredSlots', () => {
  it('siembra edad pendiente para jubilacion en fase calificacion', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'calificacion' };
    const next = ensureRequiredSlots(s, 'jubilacion');
    expect(next.slots['edad']).toEqual({ valor: null, estado: 'pendiente', pedido_count: 0 });
  });

  it('siembra edad pendiente para jubilacion_mujer', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'calificacion' };
    const next = ensureRequiredSlots(s, 'jubilacion_mujer');
    expect(next.slots['edad']).toEqual({ valor: null, estado: 'pendiente', pedido_count: 0 });
  });

  it('no pisa un slot ya lleno', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      fase: 'calificacion',
      slots: { edad: { valor: 55, estado: 'lleno', pedido_count: 1 } },
    };
    const next = ensureRequiredSlots(s, 'jubilacion');
    expect(next.slots['edad'].valor).toBe(55);
    expect(next.slots['edad'].estado).toBe('lleno');
    expect(next.slots['edad'].pedido_count).toBe(1);
  });

  it('no siembra slots para area no-jubilacion', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'calificacion' };
    const next = ensureRequiredSlots(s, 'laboral');
    expect(Object.keys(next.slots)).toHaveLength(0);
  });

  it('inmutabilidad: no muta el estado original', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'calificacion' };
    const before = JSON.stringify(s);
    ensureRequiredSlots(s, 'jubilacion');
    expect(JSON.stringify(s)).toBe(before);
  });

  it('devuelve el mismo estado si no hay cambios (area sin slots requeridos)', () => {
    const s: DialogueState = { ...createDialogueState(), fase: 'calificacion' };
    const next = ensureRequiredSlots(s, 'laboral');
    expect(next).toBe(s); // misma referencia: sin cambios
  });
});

// ── mergeSlots ────────────────────────────────────────────────────────────────

describe('mergeSlots', () => {
  it('llena un slot pendiente cuando llega el dato', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 2 } },
    };
    const next = mergeSlots(s, { edad: 60 });
    expect(next.slots['edad'].valor).toBe(60);
    expect(next.slots['edad'].estado).toBe('lleno');
  });

  it('preserva pedido_count al llenar', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 2 } },
    };
    const next = mergeSlots(s, { edad: 60 });
    expect(next.slots['edad'].pedido_count).toBe(2);
  });

  it('NO pisa un slot lleno con valor vacío (string vacío)', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: 55, estado: 'lleno', pedido_count: 0 } },
    };
    const next = mergeSlots(s, { edad: '' as any });
    expect(next.slots['edad'].valor).toBe(55);
    expect(next.slots['edad'].estado).toBe('lleno');
  });

  it('NO pisa un slot lleno con null', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: 55, estado: 'lleno', pedido_count: 0 } },
    };
    const next = mergeSlots(s, { edad: null as any });
    expect(next.slots['edad'].valor).toBe(55);
  });

  it('agrega un slot flexible no sembrado como lleno', () => {
    const s = createDialogueState();
    const next = mergeSlots(s, { hijos: 3 });
    expect(next.slots['hijos']).toEqual({ valor: 3, estado: 'lleno', pedido_count: 0 });
  });

  it('no modifica el estado si todos los valores son vacíos', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 0 } },
    };
    const next = mergeSlots(s, { edad: '' as any });
    expect(next).toBe(s); // sin cambios → misma referencia
  });

  it('inmutabilidad: no muta el estado original', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 0 } },
    };
    const before = JSON.stringify(s);
    mergeSlots(s, { edad: 50 });
    expect(JSON.stringify(s)).toBe(before);
  });
});

// ── nextPendingSlot ───────────────────────────────────────────────────────────

describe('nextPendingSlot', () => {
  it('devuelve el primer slot pendiente en orden de inserción', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: {
        edad: { valor: 55, estado: 'lleno', pedido_count: 0 },
        aportes: { valor: null, estado: 'pendiente', pedido_count: 0 },
        hijos: { valor: null, estado: 'pendiente', pedido_count: 0 },
      },
    };
    expect(nextPendingSlot(s)).toBe('aportes');
  });

  it('devuelve null cuando todo está lleno', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: 55, estado: 'lleno', pedido_count: 0 } },
    };
    expect(nextPendingSlot(s)).toBeNull();
  });

  it('devuelve null cuando slots está vacío', () => {
    expect(nextPendingSlot(createDialogueState())).toBeNull();
  });

  it('ignora slots con estado no_aplica', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: {
        edad: { valor: null, estado: 'no_aplica', pedido_count: 0 },
        aportes: { valor: null, estado: 'pendiente', pedido_count: 0 },
      },
    };
    expect(nextPendingSlot(s)).toBe('aportes');
  });

  it('respeta orden de inserción (primer pendiente = primero insertado pendiente)', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: {
        hijos: { valor: null, estado: 'pendiente', pedido_count: 0 },
        edad: { valor: null, estado: 'pendiente', pedido_count: 0 },
      },
    };
    expect(nextPendingSlot(s)).toBe('hijos');
  });
});

// ── markAsked ─────────────────────────────────────────────────────────────────

describe('markAsked', () => {
  it('incrementa pedido_count y setea ultima_pregunta con el now inyectado', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 0 } },
    };
    const now = '2026-06-30T10:00:00.000Z';
    const next = markAsked(s, 'edad', now);
    expect(next.slots['edad'].pedido_count).toBe(1);
    expect(next.ultima_pregunta).toEqual({ slot: 'edad', at: now });
  });

  it('acumula correctamente en múltiples llamadas', () => {
    let s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 0 } },
    };
    s = markAsked(s, 'edad', '2026-06-30T10:00:00.000Z');
    s = markAsked(s, 'edad', '2026-06-30T10:01:00.000Z');
    expect(s.slots['edad'].pedido_count).toBe(2);
    expect(s.ultima_pregunta?.at).toBe('2026-06-30T10:01:00.000Z');
  });

  it('si el slot no existe, lo crea pendiente con count 1', () => {
    const s = createDialogueState();
    const now = '2026-06-30T10:00:00.000Z';
    const next = markAsked(s, 'nuevo_slot', now);
    expect(next.slots['nuevo_slot']).toEqual({ valor: null, estado: 'pendiente', pedido_count: 1 });
    expect(next.ultima_pregunta).toEqual({ slot: 'nuevo_slot', at: now });
  });

  it('no usa new Date() adentro — usa el now inyectado', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 0 } },
    };
    const fakeNow = '1999-01-01T00:00:00.000Z';
    const next = markAsked(s, 'edad', fakeNow);
    expect(next.ultima_pregunta?.at).toBe(fakeNow);
  });

  it('inmutabilidad: no muta el estado original', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 0 } },
    };
    const before = JSON.stringify(s);
    markAsked(s, 'edad', '2026-06-30T10:00:00.000Z');
    expect(JSON.stringify(s)).toBe(before);
  });
});

// ── isSlotStuck + stuckSlot — anti-loop ──────────────────────────────────────

describe('isSlotStuck + stuckSlot — anti-loop', () => {
  it('false cuando pedido_count < 3', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 2 } },
    };
    expect(isSlotStuck(s, 'edad')).toBe(false);
  });

  it('true cuando pedido_count >= 3 (exactamente 3)', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 3 } },
    };
    expect(isSlotStuck(s, 'edad')).toBe(true);
  });

  it('true cuando pedido_count > 3', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 5 } },
    };
    expect(isSlotStuck(s, 'edad')).toBe(true);
  });

  it('false para slot inexistente', () => {
    expect(isSlotStuck(createDialogueState(), 'no_existe')).toBe(false);
  });

  it('tras 3 markAsked del mismo slot, isSlotStuck es true y count es 3', () => {
    let s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 0 } },
    };
    s = markAsked(s, 'edad', '2026-06-30T10:00:00.000Z');
    s = markAsked(s, 'edad', '2026-06-30T10:01:00.000Z');
    s = markAsked(s, 'edad', '2026-06-30T10:02:00.000Z');
    expect(s.slots['edad'].pedido_count).toBe(3);
    expect(isSlotStuck(s, 'edad')).toBe(true);
  });

  it('con count < 3 (2 markAsked), isSlotStuck es false', () => {
    let s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 0 } },
    };
    s = markAsked(s, 'edad', '2026-06-30T10:00:00.000Z');
    s = markAsked(s, 'edad', '2026-06-30T10:01:00.000Z');
    expect(isSlotStuck(s, 'edad')).toBe(false);
  });

  it('stuckSlot devuelve el slot stuck cuando nextPendingSlot lo está', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 3 } },
    };
    expect(stuckSlot(s)).toBe('edad');
  });

  it('stuckSlot devuelve null cuando el next pending no está stuck', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 2 } },
    };
    expect(stuckSlot(s)).toBeNull();
  });

  it('stuckSlot devuelve null cuando no hay pendientes', () => {
    const s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: 55, estado: 'lleno', pedido_count: 0 } },
    };
    expect(stuckSlot(s)).toBeNull();
  });

  it('stuckSlot devuelve null cuando slots vacío', () => {
    expect(stuckSlot(createDialogueState())).toBeNull();
  });

  it('stuckSlot: con 2 markAsked → null; con 3 markAsked → devuelve el slot', () => {
    let s: DialogueState = {
      ...createDialogueState(),
      slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 0 } },
    };
    s = markAsked(s, 'edad', '2026-06-30T10:00:00.000Z');
    s = markAsked(s, 'edad', '2026-06-30T10:01:00.000Z');
    expect(stuckSlot(s)).toBeNull();

    s = markAsked(s, 'edad', '2026-06-30T10:02:00.000Z');
    expect(stuckSlot(s)).toBe('edad');
  });
});

// ── buildDatosAportados ───────────────────────────────────────────────────────

describe('buildDatosAportados', () => {
  it('sin slots llenos → string vacío', () => {
    expect(buildDatosAportados(createDialogueState())).toBe('');
  });
  it('slots llenos → bloque con encabezado y una línea por dato', () => {
    const s = mergeSlots(createDialogueState(), { nombre: 'Ana', edad: 63, zona: 'Quilmes' });
    const block = buildDatosAportados(s);
    expect(block).toContain('DATOS YA APORTADOS');
    expect(block).toContain('- nombre: Ana');
    expect(block).toContain('- edad: 63');
    expect(block).toContain('- zona: Quilmes');
  });
  it('slots pendientes NO aparecen', () => {
    let s = createDialogueState();
    s = { ...s, slots: { edad: { valor: null, estado: 'pendiente', pedido_count: 1 } } };
    expect(buildDatosAportados(s)).toBe('');
  });
});

// ── slotsPrefill ──────────────────────────────────────────────────────────────

describe('slotsPrefill', () => {
  it('extrae solo las claves de booking, con modalidad validada', () => {
    const s = mergeSlots(createDialogueState(), {
      nombre: 'Ana', zona: 'Quilmes', modalidad: 'video', telefono: '541151749871', edad: 63,
    });
    expect(slotsPrefill(s)).toEqual({ nombre: 'Ana', zona: 'Quilmes', modalidad: 'video', telefono: '541151749871' });
  });
  it('modalidad inválida no entra; vacío → {}', () => {
    const s = mergeSlots(createDialogueState(), { modalidad: 'telepatia' });
    expect(slotsPrefill(s)).toEqual({});
    expect(slotsPrefill(createDialogueState())).toEqual({});
  });
});

import { describe, it, expect } from 'vitest';
import { evaluarPendiente, resolveCallablePhone, claveCita, nombreLimpio, type ConversationRow, type ContactMemoryRow } from '../PendienteEvaluator';

const baseConv = (over: Partial<ConversationRow> = {}): ConversationRow => ({
  id: 'c1', account_id: 'a1', phone: '5492215093499', channel: 'whatsapp',
  contact_name: 'Juan Perez', last_message: 'gracias', last_message_at: '2026-07-01T12:00:00.000Z',
  status: 'BOT', closed_at: null, close_reason: null, ...over,
});

describe('resolveCallablePhone', () => {
  it('WhatsApp: teléfono real AR → normalizado 54+10', () => {
    // 221 (La Plata) + 5093499 = 2215093499 (10 díg) → '542215093499'
    const r = resolveCallablePhone(baseConv({ phone: '5492215093499' }), null);
    expect(r).toBe('542215093499');
  });
  it('WhatsApp con id de privacidad @lid (17 díg, sin sufijo) → null (NO llamable)', () => {
    expect(resolveCallablePhone(baseConv({ phone: '27460864876906568' }), null)).toBeNull();
  });
  it('WhatsApp con intl plausible no-AR (13 díg) → lo devuelve normalizado', () => {
    // Brasil 55 + 11 987654321 → normalize lo deja igual (13 díg, dentro de 8-13).
    expect(resolveCallablePhone(baseConv({ phone: '5511987654321' }), null)).toBe('5511987654321');
  });
  it('FB/IG sin teléfono en la memoria → null (PSID no es llamable)', () => {
    const conv = baseConv({ channel: 'facebook', phone: '27998877665544' });
    expect(resolveCallablePhone(conv, null)).toBeNull();
  });
  it('FB/IG con teléfono real en slot telefono → normalizado', () => {
    const conv = baseConv({ channel: 'instagram', phone: '27998877665544' });
    const contact: ContactMemoryRow = { dialogue_state: { slots: { telefono: { valor: '011 4785-9600' } } } } as any;
    expect(resolveCallablePhone(conv, contact)).toBe('541147859600');
  });
  it('FB/IG con teléfono inválido en slot → null', () => {
    const conv = baseConv({ channel: 'facebook', phone: '27998877665544' });
    const contact: ContactMemoryRow = { dialogue_state: { slots: { telefono: { valor: 'no tengo' } } } } as any;
    expect(resolveCallablePhone(conv, contact)).toBeNull();
  });
});

describe('claveCita', () => {
  it('AR con y sin 9 colapsan a la misma clave', () => {
    expect(claveCita('5492215093499')).toBe('542215093499');
    expect(claveCita('542215093499')).toBe('542215093499');
  });
  it('null / vacío → null', () => {
    expect(claveCita(null)).toBeNull();
    expect(claveCita('')).toBeNull();
  });
});

describe('resolveCallablePhone — @lid no es llamable', () => {
  it('WhatsApp con phone @lid → null', () => {
    // baseConv está definido arriba en este archivo
    expect(resolveCallablePhone(baseConv({ phone: '2712345678901@lid' }), null)).toBeNull();
  });
});

describe('evaluarPendiente', () => {
  const vacio = new Set<string>();
  it('WhatsApp sin cita, sin opt_out → fila con datos', () => {
    const contact: ContactMemoryRow = {
      opt_out: false,
      dialogue_state: { area: 'jubilacion_mujer', slots: {} },
      calificacion: { jubilacion_mujer: { resultado: 'gratis' } },
      last_topic: 'jubilación',
    } as any;
    const fila = evaluarPendiente({ conversation: baseConv(), contact, phonesConCita: vacio });
    expect(fila).not.toBeNull();
    expect(fila!.telefono).toBe('542215093499');
    expect(fila!.nombre).toBe('Juan Perez');
    expect(fila!.canal).toBe('whatsapp');
    expect(fila!.area).toBe('jubilacion_mujer');
    expect(fila!.calificacion).toBe('gratis');
    expect(fila!.conversation_id).toBe('c1');
  });
  it('opt_out → null', () => {
    const contact = { opt_out: true } as any;
    expect(evaluarPendiente({ conversation: baseConv(), contact, phonesConCita: vacio })).toBeNull();
  });
  it('con cita (teléfono en el set) → null', () => {
    const con = new Set(['542215093499']);
    expect(evaluarPendiente({ conversation: baseConv(), contact: null, phonesConCita: con })).toBeNull();
  });
  it('sin teléfono llamable (FB/IG sin slot) → null', () => {
    const conv = baseConv({ channel: 'facebook', phone: '27998877665544' });
    expect(evaluarPendiente({ conversation: conv, contact: null, phonesConCita: vacio })).toBeNull();
  });
  it('nombre cae al slot nombre si no hay contact_name', () => {
    const conv = baseConv({ contact_name: null });
    const contact = { opt_out: false, dialogue_state: { slots: { nombre: { valor: 'Ana' } } } } as any;
    expect(evaluarPendiente({ conversation: conv, contact, phonesConCita: vacio })!.nombre).toBe('Ana');
  });
  it('estado cerrada muestra el motivo', () => {
    const conv = baseConv({ closed_at: '2026-07-02T00:00:00Z', close_reason: 'despedida' });
    expect(evaluarPendiente({ conversation: conv, contact: null, phonesConCita: vacio })!.estado).toBe('cerrada (despedida)');
  });
});

describe('nombreLimpio', () => {
  it('usa contact_name cuando es un nombre real', () => {
    expect(nombreLimpio(baseConv({ contact_name: 'Juan Perez' }), null)).toBe('Juan Perez');
  });
  it('descarta un contact_name tipo-PSID (numérico largo) y cae al slot nombre', () => {
    const conv = baseConv({ channel: 'facebook', contact_name: '24678901234567890' });
    const contact: ContactMemoryRow = { dialogue_state: { slots: { nombre: { valor: 'María López' } } } } as any;
    expect(nombreLimpio(conv, contact)).toBe('María López');
  });
  it('cae a calificacion.datos.nombre si no hay contact_name ni slot', () => {
    const conv = baseConv({ channel: 'facebook', contact_name: null });
    const contact: ContactMemoryRow = { calificacion: { jubilacion: { datos: { nombre: 'Pedro Gómez' } } } } as any;
    expect(nombreLimpio(conv, contact)).toBe('Pedro Gómez');
  });
  it('cae a current_thread.datos_parciales.nombre como último recurso', () => {
    const conv = baseConv({ channel: 'instagram', contact_name: null });
    const contact: ContactMemoryRow = { current_thread: { datos_parciales: { nombre: 'Ana Ruiz' } } } as any;
    expect(nombreLimpio(conv, contact)).toBe('Ana Ruiz');
  });
  it('devuelve null cuando no hay ningún nombre real (sólo PSID)', () => {
    const conv = baseConv({ channel: 'facebook', contact_name: '24678901234567890' });
    expect(nombreLimpio(conv, null)).toBeNull();
  });
});

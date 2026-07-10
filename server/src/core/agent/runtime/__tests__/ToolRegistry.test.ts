import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stubs de las dependencias (se inyectan, no se mockea el módulo).
const apptCreate = vi.fn();
const apptList = vi.fn();
const apptUpdate = vi.fn();
const apptGetById = vi.fn();
const kbSearch = vi.fn();
const handoff = vi.fn();
const avListOffices = vi.fn();
const avGetOffice = vi.fn();
const avFreeSlots = vi.fn();
const avHasCapacity = vi.fn();
const avOfficeHasProfessionals = vi.fn();
const avPickProfessional = vi.fn();
const setCalificacion = vi.fn();

import { ToolRegistry } from '../ToolRegistry';
import { isHolidayARInstant } from '../../context/holidays';

function makeRegistry() {
  return new ToolRegistry({
    appointments: { create: apptCreate, update: apptUpdate, getById: apptGetById, list: apptList, hasOverlap: vi.fn() } as any,
    knowledge: { search: kbSearch } as any,
    availability: { listOffices: avListOffices, getOffice: avGetOffice, freeSlots: avFreeSlots, hasCapacity: avHasCapacity, officeHasProfessionals: avOfficeHasProfessionals, pickProfessional: avPickProfessional } as any,
    handoff,
    setCalificacion,
  });
}

describe('ToolRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: oficina sin profesionales => se conserva el chequeo de cupo fijo (hasCapacity).
    avOfficeHasProfessionals.mockResolvedValue(false);
    avGetOffice.mockResolvedValue({ nombre: 'CABA', modalidad: 'presencial', direccion: null });
    apptList.mockResolvedValue([]);
  });

  it('expone los esquemas de las tools', () => {
    const schemas = makeRegistry().schemas();
    const names = schemas.map((s: any) => s.function.name).sort();
    expect(names).toEqual([
      'book_appointment', 'cancel_appointment', 'check_availability',
      'handoff_to_human', 'list_offices', 'pick_option', 'reschedule_appointment',
      'search_knowledge', 'set_qualification', 'start_booking', 'suggest_office', 'validate_phone',
    ]);
  });

  it('book_appointment inyecta account_id/phone del contexto, NO de los args del modelo', async () => {
    avHasCapacity.mockResolvedValue(true);
    apptCreate.mockResolvedValue({ id: 'appt1' });
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment',
      { account_id: 'HACK', phone: 'HACK', nombre: 'María', start_time: 's', end_time: 'e', resumen: 'consulta' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(apptCreate).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'acc1', phone: '549111', nombre: 'María' }));
  });

  it('set_qualification persiste el resultado por área con los datos y el sello', async () => {
    const reg = makeRegistry();
    const res = await reg.execute('set_qualification',
      { area: 'jubilacion_mujer', resultado: 'gratis', edad: 61, hijos: 2, aportes_aprox: 22 },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(setCalificacion).toHaveBeenCalledWith('acc1', '549111', 'jubilacion_mujer',
      expect.objectContaining({ resultado: 'gratis', datos: { edad: 61, hijos: 2, aportes_aprox: 22 } }));
    const entry = setCalificacion.mock.calls[0][3];
    expect(typeof entry.calificado_at).toBe('string');
  });

  it('set_qualification rechaza gratis incompleto (hombre 62 sin insalubres)', async () => {
    const reg = makeRegistry();
    const r = await reg.execute('set_qualification', { area: 'jubilacion_hombre', resultado: 'gratis', edad: 62, nacionalidad: 'argentino' }, { accountId: 'a1', phone: 'p1' });
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/insalubre/i);
    expect(setCalificacion).not.toHaveBeenCalled();
  });
  it('set_qualification acepta gratis completo y registra', async () => {
    const reg = makeRegistry();
    const r = await reg.execute('set_qualification', { area: 'jubilacion_hombre', resultado: 'gratis', edad: 62, insalubres: true, nacionalidad: 'argentino' }, { accountId: 'a1', phone: 'p1' });
    expect(r.ok).toBe(true);
    expect(setCalificacion).toHaveBeenCalled();
  });

  it('set_qualification conserva hijos:0 (cero hijos es dato válido, no se descarta)', async () => {
    const reg = makeRegistry();
    await reg.execute('set_qualification',
      { area: 'jubilacion_mujer', resultado: 'pago', hijos: 0 },
      { accountId: 'acc1', phone: '549111' });
    expect(setCalificacion).toHaveBeenCalledWith('acc1', '549111', 'jubilacion_mujer',
      expect.objectContaining({ resultado: 'pago', datos: { hijos: 0 } }));
  });

  it('book_appointment mapea SLOT_TAKEN a un error legible', async () => {
    avHasCapacity.mockResolvedValue(true);
    apptCreate.mockRejectedValue(new Error('SLOT_TAKEN'));
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment',
      { nombre: 'Ana', start_time: 's', end_time: 'e', resumen: 'x' }, { accountId: 'acc1', phone: 'p' });
    expect(res.ok).toBe(false);
    expect(res.error).toContain('ocupado');
  });

  it('search_knowledge propaga encontrado:false (grounding)', async () => {
    kbSearch.mockResolvedValue({ encontrado: false, snippets: [] });
    const reg = makeRegistry();
    const res = await reg.execute('search_knowledge', { query: 'algo raro' }, { accountId: 'acc1', phone: 'p' });
    expect(res.ok).toBe(true);
    expect(res.data.encontrado).toBe(false);
  });

  it('handoff_to_human llama al handoff con el contexto', async () => {
    handoff.mockResolvedValue(undefined);
    const reg = makeRegistry();
    const res = await reg.execute('handoff_to_human', { motivo: 'pide humano', resumen_caso: 'caso X' }, { accountId: 'acc1', phone: 'p' });
    expect(res.ok).toBe(true);
    expect(handoff).toHaveBeenCalledWith('acc1', 'p', expect.objectContaining({ motivo: 'pide humano' }));
  });

  it('cancel_appointment RECHAZA una cita de otro contacto (anti-IDOR)', async () => {
    apptGetById.mockResolvedValue({ id: 'x', account_id: 'acc1', phone: 'OTRO' }); // misma cuenta, otro phone
    const reg = makeRegistry();
    const res = await reg.execute('cancel_appointment', { appointment_id: 'x' }, { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(false);
    expect(apptUpdate).not.toHaveBeenCalled();
  });

  it('cancel_appointment permite cancelar la cita propia', async () => {
    apptGetById.mockResolvedValue({ id: 'x', account_id: 'acc1', phone: '549111' });
    apptUpdate.mockResolvedValue({ id: 'x' });
    const reg = makeRegistry();
    const res = await reg.execute('cancel_appointment', { appointment_id: 'x' }, { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(apptUpdate).toHaveBeenCalledWith('x', { status: 'cancelada' });
  });

  it('reschedule_appointment RECHAZA fecha en el pasado (backstop anti-alucinación 2023)', async () => {
    apptGetById.mockResolvedValue({ id: 'x', account_id: 'acc1', phone: '549111', oficina: 'CABA' });
    const reg = makeRegistry();
    const res = await reg.execute('reschedule_appointment',
      { appointment_id: 'x', start_time: '2023-07-07T15:30:00.000Z', end_time: '2023-07-07T16:00:00.000Z' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/pasada|no es v[áa]lid/i);
    expect(apptUpdate).not.toHaveBeenCalled();
  });

  it('reschedule_appointment con fecha FUTURA y cupo actualiza la cita', async () => {
    apptGetById.mockResolvedValue({ id: 'x', account_id: 'acc1', phone: '549111', oficina: 'CABA' });
    avHasCapacity.mockResolvedValue(true);
    apptUpdate.mockResolvedValue({ id: 'x' });
    const start = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString();
    const end = new Date(Date.now() + 7 * 24 * 3600 * 1000 + 30 * 60 * 1000).toISOString();
    const reg = makeRegistry();
    const res = await reg.execute('reschedule_appointment',
      { appointment_id: 'x', start_time: start, end_time: end }, { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(apptUpdate).toHaveBeenCalledWith('x', expect.objectContaining({ start_time: start, oficina: 'CABA' }));
  });

  it('reschedule_appointment RECHAZA una cita de otro contacto (anti-IDOR)', async () => {
    apptGetById.mockResolvedValue({ id: 'x', account_id: 'acc1', phone: 'OTRO', oficina: 'CABA' });
    const reg = makeRegistry();
    const res = await reg.execute('reschedule_appointment',
      { appointment_id: 'x', start_time: '2030-01-01T12:00:00.000Z', end_time: '2030-01-01T12:30:00.000Z' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(false);
    expect(apptUpdate).not.toHaveBeenCalled();
  });

  it('list_offices devuelve las oficinas de la cuenta', async () => {
    avListOffices.mockResolvedValue([{ nombre: 'CABA', modalidad: 'presencial', direccion: 'Av 1' }]);
    const reg = makeRegistry();
    const res = await reg.execute('list_offices', {}, { accountId: 'acc1', phone: 'p' });
    expect(avListOffices).toHaveBeenCalledWith('acc1');
    expect(res.ok).toBe(true);
    expect(res.data.oficinas[0].nombre).toBe('CABA');
  });

  it('check_availability devuelve slots libres reales', async () => {
    avFreeSlots.mockResolvedValue([{ start: 's', end: 'e' }]);
    const reg = makeRegistry();
    const res = await reg.execute('check_availability', { oficina: 'CABA', desde: 'd', hasta: 'h' }, { accountId: 'acc1', phone: '549111' });
    expect(avFreeSlots).toHaveBeenCalledWith('acc1', 'CABA', expect.objectContaining({ desde: 'd', hasta: 'h' }));
    expect(res.data.slots).toEqual([{ start: 's', end: 'e' }]);
  });

  it('book_appointment rechaza si no hay cupo (hasCapacity=false)', async () => {
    avHasCapacity.mockResolvedValue(false);
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment', { nombre: 'Ana', oficina: 'CABA', start_time: 's', end_time: 'e', resumen: 'x' }, { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(false);
    expect(apptCreate).not.toHaveBeenCalled();
  });

  it('book_appointment con cupo agenda y devuelve la dirección', async () => {
    avHasCapacity.mockResolvedValue(true);
    avGetOffice.mockResolvedValue({ nombre: 'CABA', modalidad: 'presencial', direccion: 'Av. 1' });
    apptCreate.mockResolvedValue({ id: 'appt1' });
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment', { nombre: 'Ana', oficina: 'CABA', start_time: 's', end_time: 'e', resumen: 'x' }, { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(res.data).toMatchObject({ appointment_id: 'appt1', direccion: 'Av. 1' });
    expect(apptCreate).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'acc1', phone: '549111', oficina: 'CABA' }));
  });

  it('book_appointment rechaza fecha en feriado AR (2026-07-09) aunque haya cupo', async () => {
    avHasCapacity.mockResolvedValue(true);
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment',
      { nombre: 'Ana', oficina: 'CABA', start_time: '2026-07-09T13:00:00.000Z', end_time: '2026-07-09T14:00:00.000Z', resumen: 'x' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/feriado/i);
    expect(apptCreate).not.toHaveBeenCalled();
  });

  it('book_appointment acepta el viernes 10/07 (el estudio trabaja el puente)', async () => {
    avHasCapacity.mockResolvedValue(true);
    apptCreate.mockResolvedValue({ id: 'appt1' });
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment',
      { nombre: 'Ana', oficina: 'CABA', start_time: '2026-07-10T13:00:00.000Z', end_time: '2026-07-10T14:00:00.000Z', resumen: 'x' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
  });

  it('book_appointment acepta el lunes hábil siguiente (2026-07-13)', async () => {
    avHasCapacity.mockResolvedValue(true);
    apptCreate.mockResolvedValue({ id: 'appt1' });
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment',
      { nombre: 'Ana', oficina: 'CABA', start_time: '2026-07-13T13:00:00.000Z', end_time: '2026-07-13T14:00:00.000Z', resumen: 'x' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
  });

  it('reschedule_appointment rechaza mover una cita a un feriado', async () => {
    apptGetById.mockResolvedValue({ id: 'a1', account_id: 'acc1', phone: '549111', oficina: 'CABA' });
    avHasCapacity.mockResolvedValue(true);
    const reg = makeRegistry();
    // Feriado 2027 (no 2026): el backstop de "fecha pasada" corre antes y taparía
    // el guard de feriado cuando el 10/07/2026 quede atrás del reloj real.
    const res = await reg.execute('reschedule_appointment',
      { appointment_id: 'a1', start_time: '2027-07-09T13:00:00.000Z', end_time: '2027-07-09T14:00:00.000Z' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/feriado/i);
    expect(apptUpdate).not.toHaveBeenCalled();
  });
});

describe('ToolRegistry book_appointment auto-asigna profesional', () => {
  const ctx = { accountId: 'acc1', phone: '549111' } as any;
  const office = { id: 'o1', account_id: 'acc1', nombre: 'CABA', modalidad: 'presencial', direccion: 'Av 1', video_link: null };

  it('oficina con profes: asigna el prof elegido', async () => {
    const created: any[] = [];
    const deps: any = {
      appointments: { create: (a: any) => { created.push(a); return Promise.resolve({ id: 'a1' }); } },
      availability: {
        getOffice: () => Promise.resolve(office),
        officeHasProfessionals: () => Promise.resolve(true),
        pickProfessional: () => Promise.resolve('p2'),
      },
      knowledge: {}, handoff: () => Promise.resolve(),
    };
    const reg = new ToolRegistry(deps);
    const r = await reg.execute('book_appointment', { nombre: 'Juan', start_time: 's', end_time: 'e', oficina: 'CABA', resumen: 'x' }, ctx);
    expect(r.ok).toBe(true);
    expect(created[0].assigned_profile_id).toBe('p2');
  });

  it('oficina con profes sin cupo: error', async () => {
    const deps: any = {
      appointments: { create: () => Promise.reject(new Error('no deberia')) },
      availability: {
        getOffice: () => Promise.resolve(office),
        officeHasProfessionals: () => Promise.resolve(true),
        pickProfessional: () => Promise.resolve(null),
      },
      knowledge: {}, handoff: () => Promise.resolve(),
    };
    const reg = new ToolRegistry(deps);
    const r = await reg.execute('book_appointment', { nombre: 'Juan', start_time: 's', end_time: 'e', oficina: 'CABA', resumen: 'x' }, ctx);
    expect(r.ok).toBe(false);
  });

  it('oficina sin profes: usa hasCapacity y assigned null', async () => {
    const created: any[] = [];
    const deps: any = {
      appointments: { create: (a: any) => { created.push(a); return Promise.resolve({ id: 'a1' }); } },
      availability: {
        getOffice: () => Promise.resolve(office),
        officeHasProfessionals: () => Promise.resolve(false),
        hasCapacity: () => Promise.resolve(true),
      },
      knowledge: {}, handoff: () => Promise.resolve(),
    };
    const reg = new ToolRegistry(deps);
    const r = await reg.execute('book_appointment', { nombre: 'Juan', start_time: 's', end_time: 'e', oficina: 'CABA', resumen: 'x' }, ctx);
    expect(r.ok).toBe(true);
    expect(created[0].assigned_profile_id ?? null).toBeNull();
  });

  it('book_appointment enriquece con ficha IA cuando hay conversación', async () => {
    const created: any[] = [];
    const deps: any = {
      appointments: { create: (a: any) => { created.push(a); return Promise.resolve({ id: 'a1' }); } },
      availability: {
        getOffice: () => Promise.resolve(office),
        officeHasProfessionals: () => Promise.resolve(false),
        hasCapacity: () => Promise.resolve(true),
      },
      knowledge: {}, handoff: () => Promise.resolve(),
      buildFicha: (_conv: string, _c: any) => Promise.resolve({ resumen_ia: 'Juan, 62, jubilación.', perfil: { edad: 62 } }),
    };
    const reg = new ToolRegistry(deps);
    const r = await reg.execute('book_appointment',
      { nombre: 'Juan', start_time: 's', end_time: 'e', oficina: 'CABA', resumen: 'x' },
      { accountId: 'acc1', phone: '549111', conversation: 'Cliente: tengo 62...' });
    expect(r.ok).toBe(true);
    expect(created[0].resumen_ia).toBe('Juan, 62, jubilación.');
    expect(created[0].perfil_json).toMatchObject({ edad: 62 });
  });
});

describe('ToolRegistry book_appointment copia la calificación del área actual y vigente (Fix 4)', () => {
  const office = { id: 'o1', account_id: 'acc1', nombre: 'CABA', modalidad: 'presencial', direccion: 'Av 1', video_link: null };
  const baseDeps = (created: any[], getCalificacion?: any): any => ({
    appointments: { create: (a: any) => { created.push(a); return Promise.resolve({ id: 'a1' }); } },
    availability: {
      getOffice: () => Promise.resolve(office),
      officeHasProfessionals: () => Promise.resolve(false),
      hasCapacity: () => Promise.resolve(true),
    },
    knowledge: {}, handoff: () => Promise.resolve(),
    ...(getCalificacion ? { getCalificacion } : {}),
  });
  // getCalificacion ahora recibe (accountId, phone, area) y devuelve {area, entry} | null:
  // simula pickVigenteCalificacion (área actual + vigente). Acá elegimos por igualdad simple.
  const pickFrom = (cal: Record<string, any>) => vi.fn(async (_a: string, _p: string, area: string | null) => {
    if (!area) return null;
    const keys = area.startsWith('jubilacion') ? ['jubilacion_hombre', 'jubilacion_mujer', 'jubilacion'] : [area];
    for (const k of keys) if (cal[k]?.resultado) return { area: k, entry: cal[k] };
    return null;
  });
  const args = { nombre: 'Juan', start_time: 's', end_time: 'e', oficina: 'CABA', resumen: 'x' };
  const ctx = (area: string | null): any => ({ accountId: 'acc1', phone: '549111', area });

  it('area=jubilacion_hombre pago vigente → tipo_consulta/monto + edad/nacionalidad/insalubres/area', async () => {
    const created: any[] = [];
    const getCalificacion = pickFrom({
      jubilacion_hombre: { resultado: 'pago', datos: { edad: 62, nacionalidad: 'argentino', insalubres: false, aportes_aprox: 25 } },
    });
    const reg = new ToolRegistry(baseDeps(created, getCalificacion));
    const r = await reg.execute('book_appointment', args, ctx('jubilacion_hombre'));
    expect(r.ok).toBe(true);
    expect(getCalificacion).toHaveBeenCalledWith('acc1', '549111', 'jubilacion_hombre');
    expect(created[0]).toMatchObject({
      area: 'jubilacion_hombre', edad: 62, nacionalidad: 'argentino', insalubres: false,
      aportes_aprox: 25, tipo_consulta: 'pago', monto_a_cobrar: 29000,
    });
  });

  it('CRÍTICO: area=laboral con jubilación pago vieja + laboral gratis → NO cobra (gratis/0/laboral)', async () => {
    const created: any[] = [];
    const getCalificacion = pickFrom({
      jubilacion_hombre: { resultado: 'pago', datos: { edad: 62 } },
      laboral: { resultado: 'gratis', datos: {} },
    });
    const reg = new ToolRegistry(baseDeps(created, getCalificacion));
    const r = await reg.execute('book_appointment', args, ctx('laboral'));
    expect(r.ok).toBe(true);
    expect(created[0]).toMatchObject({ area: 'laboral', tipo_consulta: 'gratis', monto_a_cobrar: 0 });
    expect(created[0].tipo_consulta).not.toBe('pago');
  });

  it('area vencida (getCalificacion devuelve null) → no copia (tipo_consulta null, monto 0)', async () => {
    const created: any[] = [];
    const getCalificacion = vi.fn().mockResolvedValue(null); // simula TTL vencido
    const reg = new ToolRegistry(baseDeps(created, getCalificacion));
    const r = await reg.execute('book_appointment', args, ctx('jubilacion_hombre'));
    expect(r.ok).toBe(true);
    expect(created[0]).toMatchObject({ area: null, tipo_consulta: null, monto_a_cobrar: 0 });
  });

  it('resultado "gratis" → tipo_consulta gratis y monto 0', async () => {
    const created: any[] = [];
    const getCalificacion = pickFrom({ jubilacion_mujer: { resultado: 'gratis', datos: { edad: 64 } } });
    const reg = new ToolRegistry(baseDeps(created, getCalificacion));
    const r = await reg.execute('book_appointment', args, ctx('jubilacion'));
    expect(r.ok).toBe(true);
    expect(created[0]).toMatchObject({ area: 'jubilacion_mujer', edad: 64, tipo_consulta: 'gratis', monto_a_cobrar: 0 });
  });

  it('sin ctx.area → no copia (campos null/0)', async () => {
    const created: any[] = [];
    const getCalificacion = pickFrom({ jubilacion_hombre: { resultado: 'pago', datos: { edad: 62 } } });
    const reg = new ToolRegistry(baseDeps(created, getCalificacion));
    const r = await reg.execute('book_appointment', args, ctx(null));
    expect(r.ok).toBe(true);
    expect(created[0]).toMatchObject({ area: null, tipo_consulta: null, monto_a_cobrar: 0 });
  });

  it('sin getCalificacion no rompe: campos null/0', async () => {
    const created: any[] = [];
    const reg = new ToolRegistry(baseDeps(created));
    const r = await reg.execute('book_appointment', args, ctx('laboral'));
    expect(r.ok).toBe(true);
    expect(created[0]).toMatchObject({ area: null, edad: null, nacionalidad: null, insalubres: null, tipo_consulta: null, monto_a_cobrar: 0 });
  });

  it('getCalificacion que tira error no rompe el agendado (best-effort)', async () => {
    const created: any[] = [];
    const getCalificacion = vi.fn().mockRejectedValue(new Error('db down'));
    const reg = new ToolRegistry(baseDeps(created, getCalificacion));
    const r = await reg.execute('book_appointment', args, ctx('laboral'));
    expect(r.ok).toBe(true);
    expect(created[0]).toMatchObject({ area: null, tipo_consulta: null, monto_a_cobrar: 0 });
  });

  it('book_appointment copia a_confirmar de la calificación a perfil_json', async () => {
    const created: any[] = [];
    const getCalificacion = vi.fn().mockResolvedValue({ area: 'jubilacion_mujer', entry: { resultado: 'gratis', datos: { edad: 61, a_confirmar: ['aportes'] } } });
    const reg = new ToolRegistry(baseDeps(created, getCalificacion));
    const r = await reg.execute('book_appointment', args, ctx('jubilacion_mujer'));
    expect(r.ok).toBe(true);
    expect(created[0].perfil_json).toMatchObject({ a_confirmar: ['aportes'] });
    expect(created[0]).toMatchObject({ area: 'jubilacion_mujer', tipo_consulta: 'gratis', monto_a_cobrar: 0 });
  });

  it('book_appointment sin a_confirmar no ensucia perfil_json', async () => {
    const created: any[] = [];
    const getCalificacion = vi.fn().mockResolvedValue({ area: 'jubilacion_mujer', entry: { resultado: 'gratis', datos: { edad: 64 } } });
    const reg = new ToolRegistry(baseDeps(created, getCalificacion));
    const r = await reg.execute('book_appointment', args, ctx('jubilacion_mujer'));
    expect(r.ok).toBe(true);
    expect(created[0].perfil_json ?? null).toBeNull();
  });
});

describe('ToolRegistry — tools nuevas (Capacidades 3 y 4)', () => {
  const ctx = { accountId: 'acc1', phone: '549111' } as any;

  it('suggest_office delega en el ZoneResolver inyectado', async () => {
    const suggestOffice = vi.fn().mockResolvedValue({ oficina_sugerida: 'Quilmes', confianza: 'alta', necesita_aclaracion: false, siempre_ofrecer_video: true });
    const reg = new ToolRegistry({ appointments: {}, availability: {}, knowledge: {}, handoff: vi.fn(), suggestOffice } as any);
    const r = await reg.execute('suggest_office', { location_text: 'soy de Lanús' }, ctx);
    expect(suggestOffice).toHaveBeenCalledWith('acc1', 'soy de Lanús');
    expect(r.ok).toBe(true);
    expect(r.data.oficina_sugerida).toBe('Quilmes');
  });

  it('pick_option resuelve "el tercero" contra lo ofrecido', async () => {
    const offered = {
      get: vi.fn().mockResolvedValue([
        { index: 1, label: 'A', value: 'v1' }, { index: 2, label: 'B', value: 'v2' }, { index: 3, label: 'C', value: 'v3' },
      ]),
      set: vi.fn(),
    };
    const reg = new ToolRegistry({ appointments: {}, availability: {}, knowledge: {}, handoff: vi.fn(), offered } as any);
    const r = await reg.execute('pick_option', { user_text: 'el tercero' }, ctx);
    expect(r.ok).toBe(true);
    expect(r.data.matched_value).toBe('v3');
  });

  it('list_offices guarda las opciones ofrecidas (para pick_option)', async () => {
    const offered = { get: vi.fn(), set: vi.fn().mockResolvedValue(undefined) };
    const reg = new ToolRegistry({
      appointments: {}, knowledge: {}, handoff: vi.fn(), offered,
      availability: { listOffices: () => Promise.resolve([{ nombre: 'CABA', modalidad: 'presencial', direccion: 'Av 1' }]) },
    } as any);
    await reg.execute('list_offices', {}, ctx);
    expect(offered.set).toHaveBeenCalledWith('acc1', '549111', expect.arrayContaining([
      expect.objectContaining({ value: 'CABA' }),
    ]));
  });
});

// Caso prod 2026-07-09 (queja R.Prats): el cliente acepta un horario de video pero
// el pool ofrecido (DANIELA) ya se llenó → el bot corría la FECHA en vez de agendar
// el MISMO horario con otra abogada de video. Fallback determinístico de pool:
// video lleno → probar los otros pools de video para el mismo slot. Presencial NO
// (el cliente eligió un lugar físico).
describe('book/reschedule — fallback de pool video (mismo horario, otra abogada)', () => {
  const ctx = { accountId: 'acc1', phone: '549111' } as any;
  const daniela = { id: 'v1', account_id: 'acc1', nombre: 'DANIELA VIDEOS', modalidad: 'video', direccion: null, video_link: 'https://meet/daniela' };
  const lara = { id: 'v2', account_id: 'acc1', nombre: 'LARA VIDEOS', modalidad: 'video', direccion: null, video_link: 'https://meet/lara' };
  const caba = { id: 'p1', account_id: 'acc1', nombre: 'CABA', modalidad: 'presencial', direccion: 'Av 1', video_link: null };
  const OFFICES = [daniela, lara, caba];

  const futuro = (dias: number) => {
    let d = new Date(Date.now() + dias * 24 * 3600 * 1000);
    while (isHolidayARInstant(d)) d = new Date(d.getTime() + 24 * 3600 * 1000);
    return d.toISOString();
  };
  const START = futuro(2);
  const END = new Date(new Date(START).getTime() + 15 * 60 * 1000).toISOString();

  const makeDeps = (overrides: any = {}) => {
    const created: any[] = [];
    const updated: any[] = [];
    const deps: any = {
      appointments: {
        list: () => Promise.resolve([]),
        create: (a: any) => { created.push(a); return Promise.resolve({ id: 'a1' }); },
        update: (id: string, u: any) => { updated.push({ id, ...u }); return Promise.resolve({ id }); },
        getById: () => Promise.resolve(null),
      },
      availability: {
        getOffice: (_a: string, nombre: string) => Promise.resolve(OFFICES.find((o) => o.nombre === nombre) ?? null),
        listOffices: () => Promise.resolve(OFFICES),
        officeHasProfessionals: () => Promise.resolve(true),
        // DANIELA llena, LARA con lugar.
        pickProfessional: (office: any) => Promise.resolve(office.nombre === 'LARA VIDEOS' ? 'p-lara' : null),
      },
      knowledge: {}, handoff: () => Promise.resolve(),
      ...overrides,
    };
    return { deps, created, updated };
  };

  it('pool video lleno → agenda el MISMO horario en otro pool video (otra abogada)', async () => {
    const { deps, created } = makeDeps();
    const reg = new ToolRegistry(deps);
    const r = await reg.execute('book_appointment',
      { nombre: 'Ana', start_time: START, end_time: END, oficina: 'DANIELA VIDEOS', resumen: 'x' }, ctx);
    expect(r.ok).toBe(true);
    expect(created[0].oficina).toBe('LARA VIDEOS');
    expect(created[0].assigned_profile_id).toBe('p-lara');
    expect(created[0].start_time).toBe(START);
    expect(r.data.oficina).toBe('LARA VIDEOS');
    expect(r.data.video_link).toBe('https://meet/lara');
  });

  it('todos los pools video llenos → error sin cupo, no crea nada', async () => {
    const { deps, created } = makeDeps();
    deps.availability.pickProfessional = () => Promise.resolve(null);
    const reg = new ToolRegistry(deps);
    const r = await reg.execute('book_appointment',
      { nombre: 'Ana', start_time: START, end_time: END, oficina: 'DANIELA VIDEOS', resumen: 'x' }, ctx);
    expect(r.ok).toBe(false);
    expect(created.length).toBe(0);
  });

  it('presencial lleno → NO cambia de sede (el cliente eligió un lugar)', async () => {
    const { deps, created } = makeDeps();
    deps.availability.officeHasProfessionals = () => Promise.resolve(false);
    deps.availability.hasCapacity = () => Promise.resolve(false);
    const listSpy = vi.fn(() => Promise.resolve(OFFICES));
    deps.availability.listOffices = listSpy;
    const reg = new ToolRegistry(deps);
    const r = await reg.execute('book_appointment',
      { nombre: 'Ana', start_time: START, end_time: END, oficina: 'CABA', resumen: 'x' }, ctx);
    expect(r.ok).toBe(false);
    expect(created.length).toBe(0);
    expect(listSpy).not.toHaveBeenCalled();
  });

  it('reschedule: pool video lleno → mueve la cita al mismo horario con otra abogada', async () => {
    const { deps, updated } = makeDeps();
    deps.appointments.getById = () => Promise.resolve({ id: 'x1', account_id: 'acc1', phone: '549111', oficina: 'DANIELA VIDEOS' });
    const reg = new ToolRegistry(deps);
    const r = await reg.execute('reschedule_appointment',
      { appointment_id: 'x1', start_time: START, end_time: END }, ctx);
    expect(r.ok).toBe(true);
    expect(updated[0]).toMatchObject({ id: 'x1', oficina: 'LARA VIDEOS', assigned_profile_id: 'p-lara', start_time: START });
    expect(r.data.video_link).toBe('https://meet/lara');
  });
});

// Caso prod 2026-07-07 (Pablo Alonge): "puede ser mejor el miercoles" tras agendar
// arranco un booking NUEVO y quedaron DOS citas pendientes (la vieja murio como
// no-show falso). book_appointment con cita futura activa debe REPROGRAMARLA.
describe('book_appointment — anti-duplicado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    avOfficeHasProfessionals.mockResolvedValue(false);
    avGetOffice.mockResolvedValue({ nombre: 'CABA', modalidad: 'presencial', direccion: null });
    apptList.mockResolvedValue([]);
  });
  // Fechas relativas al reloj real: si caen en feriado AR, el guard de feriados
  // rechazaría el booking y el test fallaría por el motivo equivocado. Se saltean.
  const futuroHabil = (dias: number) => {
    let d = new Date(Date.now() + dias * 24 * 3600 * 1000);
    while (isHolidayARInstant(d)) d = new Date(d.getTime() + 24 * 3600 * 1000);
    return d.toISOString();
  };
  const FUTURO_VIEJO = futuroHabil(1);
  const FUTURO_NUEVO = futuroHabil(5); // gap > máx. feriados consecutivos: nunca pisa a VIEJO

  it('con cita futura activa del contacto → reprograma esa cita, NO crea otra', async () => {
    avHasCapacity.mockResolvedValue(true);
    apptList.mockResolvedValue([
      { id: 'appt-viejo', account_id: 'acc1', phone: '549111', status: 'pendiente', start_time: FUTURO_VIEJO, oficina: 'CABA' },
    ]);
    apptGetById.mockResolvedValue({ id: 'appt-viejo', account_id: 'acc1', phone: '549111', oficina: 'CABA' });
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment',
      { nombre: 'Pablo', start_time: FUTURO_NUEVO, end_time: FUTURO_NUEVO, oficina: 'CABA', resumen: '' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(apptCreate).not.toHaveBeenCalled();
    expect(apptUpdate).toHaveBeenCalledWith('appt-viejo', expect.objectContaining({ start_time: FUTURO_NUEVO }));
  });

  it('cita previa cancelada o pasada → crea una cita nueva normal', async () => {
    avHasCapacity.mockResolvedValue(true);
    apptCreate.mockResolvedValue({ id: 'appt-nuevo' });
    apptList.mockResolvedValue([
      { id: 'a1', account_id: 'acc1', phone: '549111', status: 'cancelada', start_time: FUTURO_VIEJO },
      { id: 'a2', account_id: 'acc1', phone: '549111', status: 'pendiente', start_time: '2026-07-01T12:00:00Z' },
    ]);
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment',
      { nombre: 'Pablo', start_time: FUTURO_NUEVO, end_time: FUTURO_NUEVO, oficina: 'CABA', resumen: '' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(apptCreate).toHaveBeenCalled();
    expect(apptUpdate).not.toHaveBeenCalled();
  });

  it('cita futura de OTRO contacto → no interfiere, crea normal', async () => {
    avHasCapacity.mockResolvedValue(true);
    apptCreate.mockResolvedValue({ id: 'appt-nuevo' });
    apptList.mockResolvedValue([
      { id: 'a1', account_id: 'acc1', phone: 'OTRO', status: 'pendiente', start_time: FUTURO_VIEJO },
    ]);
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment',
      { nombre: 'Pablo', start_time: FUTURO_NUEVO, end_time: FUTURO_NUEVO, oficina: 'CABA', resumen: '' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(apptCreate).toHaveBeenCalled();
  });
});

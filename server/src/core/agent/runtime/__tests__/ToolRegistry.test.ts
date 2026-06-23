import { describe, it, expect, vi, beforeEach } from 'vitest';

// Stubs de las dependencias (se inyectan, no se mockea el módulo).
const apptCreate = vi.fn();
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

import { ToolRegistry } from '../ToolRegistry';

function makeRegistry() {
  return new ToolRegistry({
    appointments: { create: apptCreate, update: apptUpdate, getById: apptGetById, list: vi.fn().mockResolvedValue([]), hasOverlap: vi.fn() } as any,
    knowledge: { search: kbSearch } as any,
    availability: { listOffices: avListOffices, getOffice: avGetOffice, freeSlots: avFreeSlots, hasCapacity: avHasCapacity, officeHasProfessionals: avOfficeHasProfessionals, pickProfessional: avPickProfessional } as any,
    handoff,
  });
}

describe('ToolRegistry', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Defaults: oficina sin profesionales => se conserva el chequeo de cupo fijo (hasCapacity).
    avOfficeHasProfessionals.mockResolvedValue(false);
    avGetOffice.mockResolvedValue({ nombre: 'CABA', modalidad: 'presencial', direccion: null });
  });

  it('expone los esquemas de las tools', () => {
    const schemas = makeRegistry().schemas();
    const names = schemas.map((s: any) => s.function.name).sort();
    expect(names).toEqual([
      'book_appointment', 'cancel_appointment', 'check_availability',
      'handoff_to_human', 'list_offices', 'reschedule_appointment', 'search_knowledge',
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
});

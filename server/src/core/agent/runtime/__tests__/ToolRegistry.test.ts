import { describe, it, expect, vi } from 'vitest';

// Stubs de las dependencias (se inyectan, no se mockea el módulo).
const apptCreate = vi.fn();
const apptUpdate = vi.fn();
const apptGetById = vi.fn();
const kbSearch = vi.fn();
const handoff = vi.fn();

import { ToolRegistry } from '../ToolRegistry';

function makeRegistry() {
  return new ToolRegistry({
    appointments: { create: apptCreate, update: apptUpdate, getById: apptGetById, list: vi.fn().mockResolvedValue([]), hasOverlap: vi.fn() } as any,
    knowledge: { search: kbSearch } as any,
    handoff,
  });
}

describe('ToolRegistry', () => {
  it('expone los esquemas de las 6 tools', () => {
    const schemas = makeRegistry().schemas();
    const names = schemas.map((s: any) => s.function.name).sort();
    expect(names).toEqual([
      'book_appointment', 'cancel_appointment', 'check_availability',
      'handoff_to_human', 'reschedule_appointment', 'search_knowledge',
    ]);
  });

  it('book_appointment inyecta account_id/phone del contexto, NO de los args del modelo', async () => {
    apptCreate.mockResolvedValue({ id: 'appt1' });
    const reg = makeRegistry();
    const res = await reg.execute('book_appointment',
      { account_id: 'HACK', phone: 'HACK', nombre: 'María', start_time: 's', end_time: 'e', resumen: 'consulta' },
      { accountId: 'acc1', phone: '549111' });
    expect(res.ok).toBe(true);
    expect(apptCreate).toHaveBeenCalledWith(expect.objectContaining({ account_id: 'acc1', phone: '549111', nombre: 'María' }));
  });

  it('book_appointment mapea SLOT_TAKEN a un error legible', async () => {
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
});

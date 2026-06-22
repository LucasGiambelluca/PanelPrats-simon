import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase (account_offices) + AppointmentService.list.
const offices: any[] = [];
vi.mock('../../config/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: offices, error: null }) }) }) }) },
}));
const apptList = vi.fn();
vi.mock('../AppointmentService', () => ({ AppointmentService: { list: (...a: any[]) => apptList(...a) } }));

import { AvailabilityService } from '../AvailabilityService';

const OFICINA = { id: 'o1', account_id: 'acc1', nombre: 'CABA', modalidad: 'presencial', direccion: 'Av. 1', dias: [1,2,3,4,5], hora_inicio: '09:00', hora_fin: '18:00', slot_min: 60, capacidad: 2, buffer_min: 0, activa: true, orden: 0 };

describe('AvailabilityService.listOffices / getOffice', () => {
  beforeEach(() => { offices.length = 0; apptList.mockReset(); });

  it('lista oficinas y matchea por nombre normalizado', async () => {
    offices.push(OFICINA);
    const svc = new AvailabilityService();
    expect((await svc.listOffices('acc1')).map((o) => o.nombre)).toEqual(['CABA']);
    expect((await svc.getOffice('acc1', 'caba'))?.id).toBe('o1'); // case-insensitive
    expect(await svc.getOffice('acc1', 'Quilmes')).toBeNull();
  });
});

describe('AvailabilityService.hasCapacity', () => {
  beforeEach(() => { offices.length = 0; offices.push(OFICINA); apptList.mockReset(); });
  const start = '2026-06-22T13:00:00.000Z', end = '2026-06-22T14:00:00.000Z';

  it('hay cupo si las citas solapadas < capacidad', async () => {
    apptList.mockResolvedValue([
      { oficina: 'CABA', status: 'pendiente', start_time: start, end_time: end },
    ]); // 1 solapada, capacidad 2
    const svc = new AvailabilityService();
    expect(await svc.hasCapacity('acc1', 'CABA', start, end)).toBe(true);
  });

  it('no hay cupo si solapadas >= capacidad', async () => {
    apptList.mockResolvedValue([
      { oficina: 'CABA', status: 'pendiente', start_time: start, end_time: end },
      { oficina: 'CABA', status: 'confirmada', start_time: start, end_time: end },
    ]); // 2 solapadas, capacidad 2 → lleno
    const svc = new AvailabilityService();
    expect(await svc.hasCapacity('acc1', 'CABA', start, end)).toBe(false);
  });

  it('ignora canceladas y otras oficinas', async () => {
    apptList.mockResolvedValue([
      { oficina: 'CABA', status: 'cancelada', start_time: start, end_time: end },
      { oficina: 'Quilmes', status: 'pendiente', start_time: start, end_time: end },
    ]);
    const svc = new AvailabilityService();
    expect(await svc.hasCapacity('acc1', 'CABA', start, end)).toBe(true);
  });

  it('oficina no configurada → capacidad 1', async () => {
    offices.length = 0;
    apptList.mockResolvedValue([{ oficina: 'X', status: 'pendiente', start_time: start, end_time: end }]);
    const svc = new AvailabilityService();
    expect(await svc.hasCapacity('acc1', 'X', start, end)).toBe(false); // 1 solapada >= cap 1
  });
});

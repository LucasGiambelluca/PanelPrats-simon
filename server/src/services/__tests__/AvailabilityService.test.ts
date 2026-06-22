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

describe('AvailabilityService.freeSlots', () => {
  beforeEach(() => { offices.length = 0; offices.push({ ...OFICINA, slot_min: 60, capacidad: 1 }); apptList.mockReset(); apptList.mockResolvedValue([]); });

  it('genera slots dentro del horario y días configurados', async () => {
    const svc = new AvailabilityService();
    const slots = await svc.freeSlots('acc1', 'CABA', { now: new Date('2026-06-22T12:00:00.000Z'), max: 3 } as any);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(3);
    const d = (new Date(slots[0].end).getTime() - new Date(slots[0].start).getTime()) / 60000;
    expect(d).toBe(60);
  });

  it('capacidad 2: un slot con 1 cita sigue ofreciéndose; con 2 no', async () => {
    offices[0] = { ...OFICINA, slot_min: 60, capacidad: 2 };
    const now = new Date('2026-06-22T12:00:00.000Z');
    const svc = new AvailabilityService();
    const libres = await svc.freeSlots('acc1', 'CABA', { now, max: 10 } as any);
    const first = libres[0];
    apptList.mockResolvedValue([
      { oficina: 'CABA', status: 'pendiente', start_time: first.start, end_time: first.end },
      { oficina: 'CABA', status: 'confirmada', start_time: first.start, end_time: first.end },
    ]);
    const libres2 = await svc.freeSlots('acc1', 'CABA', { now, max: 10 } as any);
    expect(libres2.find((s) => s.start === first.start)).toBeUndefined();
  });

  it('oficina inexistente → []', async () => {
    const svc = new AvailabilityService();
    expect(await svc.freeSlots('acc1', 'Inexistente', { now: new Date('2026-06-22T12:00:00.000Z') } as any)).toEqual([]);
  });
});

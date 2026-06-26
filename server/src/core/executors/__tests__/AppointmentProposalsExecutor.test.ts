import { describe, it, expect, vi, beforeEach } from 'vitest';

// Unit test aislado del motor en cascada actual. Mockeamos:
//  - AvailabilityService.proposeCascade (el executor delega ahí para presencial/video),
//  - AppointmentService (para no pegar a la DB),
//  - AIService (resolvePreferredDate puede llamarlo; lo neutralizamos).
const proposeCascade = vi.fn();
const freeSlots = vi.fn();
const getOffice = vi.fn();
vi.mock('../../../services/AvailabilityService', () => ({
  AvailabilityService: class {
    proposeCascade = (...a: any[]) => proposeCascade(...a);
    freeSlots = (...a: any[]) => freeSlots(...a);
    getOffice = (...a: any[]) => getOffice(...a);
  },
}));
vi.mock('../../../services/AppointmentService', () => ({
  AppointmentService: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock('../../../services/AIService', () => ({
  AIService: { complete: vi.fn().mockResolvedValue('') },
}));

import { AppointmentProposalsExecutor } from '../AppointmentProposalsExecutor';

beforeEach(() => {
  proposeCascade.mockReset();
  freeSlots.mockReset();
  getOffice.mockReset();
});

describe('AppointmentProposalsExecutor (motor en cascada)', () => {
  it('presencial: delega en proposeCascade y guarda los slots en *_array', async () => {
    proposeCascade.mockResolvedValue([
      { start: '2026-06-22T13:00:00.000Z', end: '2026-06-22T14:00:00.000Z', oficina: 'CABA', profileId: 'p1' },
    ]);
    const ctx: any = { accountId: 'acc1', oficina: 'Presencial CABA' };
    const res = await new AppointmentProposalsExecutor().execute({ maxProposals: 3, outputVariable: 'propuestas' }, ctx);

    expect(proposeCascade).toHaveBeenCalledWith('acc1', expect.objectContaining({ modalidad: 'presencial' }));
    expect(res.updatedContext!.propuestas_array).toHaveLength(1);
    expect(res.messages[0]).toMatch(/\d{2}:\d{2}/); // formateó el slot
  });

  it('video: cascada con modalidad video', async () => {
    proposeCascade.mockResolvedValue([
      { start: '2026-06-22T18:00:00.000Z', end: '2026-06-22T18:30:00.000Z', oficina: 'Videollamada', profileId: null },
    ]);
    const ctx: any = { accountId: 'acc1', oficina: 'Videollamada' };
    await new AppointmentProposalsExecutor().execute({ outputVariable: 'p' }, ctx);

    expect(proposeCascade).toHaveBeenCalledWith('acc1', expect.objectContaining({ modalidad: 'video' }));
  });

  it('filtra por turno: "a la tarde" deja solo los slots de la tarde', async () => {
    proposeCascade.mockResolvedValue([
      { start: '2026-06-22T13:00:00.000Z', end: '2026-06-22T14:00:00.000Z' }, // 10:00 AR → mañana
      { start: '2026-06-22T18:00:00.000Z', end: '2026-06-22T19:00:00.000Z' }, // 15:00 AR → tarde
    ]);
    // "mañana a la tarde": resolvePreferredDate matchea "mañana" (sin IA) y el turno es "tarde".
    const ctx: any = { accountId: 'acc1', oficina: 'Presencial CABA', fecha_desde: 'mañana a la tarde' };
    const res = await new AppointmentProposalsExecutor().execute({ outputVariable: 'p', maxProposals: 5 }, ctx);

    const arr = res.updatedContext!.p_array as any[];
    expect(arr).toHaveLength(1);
    expect(arr[0].start).toBe('2026-06-22T18:00:00.000Z');
  });

  it('sin slots disponibles: mensaje claro y array vacío', async () => {
    proposeCascade.mockResolvedValue([]);
    const ctx: any = { accountId: 'acc1', oficina: 'Presencial CABA' };
    const res = await new AppointmentProposalsExecutor().execute({ outputVariable: 'p' }, ctx);

    expect(res.updatedContext!.p_array).toHaveLength(0);
    expect(res.messages[0]).toMatch(/no hay horarios/i);
  });
});

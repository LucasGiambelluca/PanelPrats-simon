import { describe, it, expect, vi } from 'vitest';
import { BookingService } from '../BookingService';

// Bug prod 9/7: para video el flujo pedía slots SOLO de la primera agenda de video
// (DANIELA) y si estaba llena corría la fecha. Con videoCascade, los slots vienen
// de TODAS las agendas de video en cascada y se agenda en la agenda del slot elegido.

function makeStore() {
  const mem = new Map<string, any>();
  return {
    get: async (a: string, p: string) => mem.get(a + '|' + p),
    set: async (a: string, p: string, s: any) => { mem.set(a + '|' + p, s); },
    clear: async (a: string, p: string) => { mem.delete(a + '|' + p); },
  } as any;
}

const CASCADE_SLOTS = [
  { start: '2026-07-20T14:00:00.000Z', end: '2026-07-20T14:15:00.000Z', oficina: 'DANIELA VIDEOS', profileId: 'p-dani' },
  { start: '2026-07-20T15:00:00.000Z', end: '2026-07-20T15:15:00.000Z', oficina: 'LOURDES VIDEOS', profileId: 'p-lourdes' },
  { start: '2026-07-20T16:00:00.000Z', end: '2026-07-20T16:15:00.000Z', oficina: 'LOURDES VIDEOS', profileId: 'p-lourdes' },
];

function makeService() {
  const book = vi.fn(async () => ({ direccion: null, video_link: 'https://meet/x', modalidad: 'video' }));
  const freeSlots = vi.fn(async () => { throw new Error('freeSlots de UNA oficina no debería usarse para video'); });
  const videoCascade = vi.fn(async () => CASCADE_SLOTS);
  const svc = new BookingService({
    store: makeStore(),
    suggestOffice: vi.fn(async () => ({ oficina_sugerida: null, necesita_aclaracion: false })),
    listOffices: vi.fn(async () => [
      { nombre: 'DANIELA VIDEOS', modalidad: 'video', direccion: null },
      { nombre: 'LOURDES VIDEOS', modalidad: 'video', direccion: null },
      { nombre: 'DAIANA CABA', modalidad: 'presencial', direccion: 'Corrientes 1386' },
    ]),
    freeSlots,
    videoCascade,
    book,
    reschedule: vi.fn(async () => ({ modalidad: 'video' })),
  } as any);
  return { svc, book, freeSlots, videoCascade };
}

describe('BookingService — cascada de agendas para video', () => {
  it('video: los slots ofrecidos salen de videoCascade (varias agendas), no de una sola', async () => {
    const { svc, videoCascade } = makeService();
    const r = await svc.start('acc1', '549111', { modalidad: 'video', nombre: 'Juan' }, 'conv');
    expect(videoCascade).toHaveBeenCalled();
    expect(r.active).toBe(true);
    expect(r.messages.join(' ')).toMatch(/lun|20\/7|20\/07/i); // ofrece horarios reales
  });

  it('elegir un slot de la segunda agenda agenda EN esa agenda (oficina del slot)', async () => {
    const { svc, book } = makeService();
    await svc.start('acc1', '549111', { modalidad: 'video', nombre: 'Juan' }, 'conv');
    await svc.advance('acc1', '549111', 'el segundo', 'conv');
    expect(book).toHaveBeenCalledWith('acc1', '549111', 'conv', null, expect.objectContaining({
      start: '2026-07-20T15:00:00.000Z',
      oficina: 'LOURDES VIDEOS',
      profileId: 'p-lourdes',
    }));
  });

  it('presencial sigue usando freeSlots de la sede elegida (sin cascada)', async () => {
    const { svc, videoCascade } = makeService();
    // Zona resuelta a la sede presencial + freeSlots de esa oficina con slots normales.
    (svc as any).deps.suggestOffice = vi.fn(async () => ({ oficina_sugerida: 'DAIANA CABA', necesita_aclaracion: false }));
    const freeSlotsPres = vi.fn(async () => [
      { start: '2026-07-20T14:00:00.000Z', end: '2026-07-20T14:30:00.000Z' },
    ]);
    (svc as any).deps.freeSlots = freeSlotsPres;
    const r = await svc.start('acc1', '549111', { modalidad: 'presencial', zona: 'CABA', nombre: 'Ana' }, 'conv');
    expect(r.active).toBe(true);
    await svc.advance('acc1', '549111', 'la de CABA', 'conv'); // elige la sede → carga slots
    expect(videoCascade).not.toHaveBeenCalled();
    expect(freeSlotsPres).toHaveBeenCalledWith('acc1', 'DAIANA CABA', expect.anything());
  });
});

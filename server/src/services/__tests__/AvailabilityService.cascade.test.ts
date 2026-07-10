import { describe, it, expect, vi } from 'vitest';
import { AvailabilityService } from '../AvailabilityService';

// Reglas del estudio (agendas.txt 24/6): prioridad Daniela > Lourdes > Lara... PERO
// con inmediatez: si Daniela no tiene lugar hasta dentro de días y otra abogada
// tiene HOY/MAÑANA, se ofrece el día más cercano. Dentro de un mismo día, la de
// mayor prioridad va primero (llenar la agenda de Daniela primero).
// Bug prod 9/7: el bot corría la FECHA con Daniela en vez de pasar a Lourdes/Lara.

const OF = (nombre: string, orden: number) => ({
  id: nombre, account_id: 'acc1', nombre, modalidad: 'video', orden,
}) as any;

// Slots en horario laboral AR (14:00Z = 11:00 AR).
const slot = (day: string, h: string) => ({
  start: `2026-07-${day}T${h}:00:00.000Z`,
  end: `2026-07-${day}T${h}:15:00.000Z`,
});

function makeService(slotsByOffice: Record<string, Array<{ start: string; end: string }>>) {
  const av = new AvailabilityService();
  vi.spyOn(av, 'listOffices').mockResolvedValue([OF('DANIELA VIDEOS', 1), OF('LOURDES VIDEOS', 2)]);
  vi.spyOn(av, 'freeSlots').mockImplementation(async (_a: string, nombre: string) => slotsByOffice[nombre] ?? []);
  vi.spyOn(av, 'pickProfessional').mockImplementation(async (office: any) => 'prof-' + office.nombre);
  return av;
}

describe('AvailabilityService.proposeCascade — inmediatez + prioridad por día', () => {
  it('Daniela recién el 24/07, Lourdes tiene el 20/07 → el día más cercano gana (Lourdes primero)', async () => {
    const av = makeService({
      'DANIELA VIDEOS': [slot('24', '14'), slot('24', '15')],
      'LOURDES VIDEOS': [slot('20', '14'), slot('20', '15')],
    });
    const out = await av.proposeCascade('acc1', { modalidad: 'video', max: 3 });
    expect(out[0]).toMatchObject({ start: '2026-07-20T14:00:00.000Z', oficina: 'LOURDES VIDEOS' });
    expect(out[1]).toMatchObject({ start: '2026-07-20T15:00:00.000Z', oficina: 'LOURDES VIDEOS' });
    expect(out[2]).toMatchObject({ start: '2026-07-24T14:00:00.000Z', oficina: 'DANIELA VIDEOS' });
  });

  it('mismo día en las dos agendas → los slots de Daniela (prioridad 1) van primero', async () => {
    const av = makeService({
      'DANIELA VIDEOS': [slot('20', '16')],
      'LOURDES VIDEOS': [slot('20', '14')],
    });
    const out = await av.proposeCascade('acc1', { modalidad: 'video', max: 2 });
    expect(out[0]).toMatchObject({ oficina: 'DANIELA VIDEOS', start: '2026-07-20T16:00:00.000Z' });
    expect(out[1]).toMatchObject({ oficina: 'LOURDES VIDEOS', start: '2026-07-20T14:00:00.000Z' });
  });

  it('mismo horario exacto en dos agendas → se ofrece una sola vez, con la de mayor prioridad', async () => {
    const av = makeService({
      'DANIELA VIDEOS': [slot('20', '14')],
      'LOURDES VIDEOS': [slot('20', '14'), slot('20', '15')],
    });
    const out = await av.proposeCascade('acc1', { modalidad: 'video', max: 3 });
    expect(out.filter((s) => s.start === '2026-07-20T14:00:00.000Z')).toHaveLength(1);
    expect(out[0].oficina).toBe('DANIELA VIDEOS');
  });

  it('etiqueta cada slot con el profesional de SU agenda', async () => {
    const av = makeService({
      'DANIELA VIDEOS': [],
      'LOURDES VIDEOS': [slot('20', '14')],
    });
    const out = await av.proposeCascade('acc1', { modalidad: 'video', max: 1 });
    expect(out[0].profileId).toBe('prof-LOURDES VIDEOS');
  });
});

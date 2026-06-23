import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock supabase (table-aware) + AppointmentService.list.
// Datos por tabla que cada test setea. Cada query soporta select().eq()...(order|then)
const db: Record<string, any[]> = {
  account_offices: [], office_professionals: [], professional_availability: [],
  professional_blocks: [], profiles: [],
};
vi.mock('../../config/supabase', () => {
  const builder = (table: string) => {
    let rows = [...(db[table] || [])];
    const chain: any = {
      select: () => chain,
      eq: (col: string, val: any) => { rows = rows.filter((r) => r[col] === val); return chain; },
      order: () => Promise.resolve({ data: rows, error: null }),
      then: (res: any) => Promise.resolve({ data: rows, error: null }).then(res),
    };
    return chain;
  };
  return { supabase: { from: (t: string) => builder(t) } };
});
const apptList = vi.fn();
vi.mock('../AppointmentService', () => ({ AppointmentService: { list: (...a: any[]) => apptList(...a) } }));

import { AvailabilityService } from '../AvailabilityService';

const OFICINA = { id: 'o1', account_id: 'acc1', nombre: 'CABA', modalidad: 'presencial', direccion: 'Av. 1', dias: [1,2,3,4,5], hora_inicio: '09:00', hora_fin: '18:00', slot_min: 60, capacidad: 2, buffer_min: 0, activa: true, orden: 0 };

describe('AvailabilityService.listOffices / getOffice', () => {
  beforeEach(() => { db.account_offices.length = 0; apptList.mockReset(); });

  it('lista oficinas y matchea por nombre normalizado', async () => {
    db.account_offices.push(OFICINA);
    const svc = new AvailabilityService();
    expect((await svc.listOffices('acc1')).map((o) => o.nombre)).toEqual(['CABA']);
    expect((await svc.getOffice('acc1', 'caba'))?.id).toBe('o1'); // case-insensitive
    expect(await svc.getOffice('acc1', 'Quilmes')).toBeNull();
  });
});

describe('AvailabilityService.hasCapacity', () => {
  beforeEach(() => { db.account_offices.length = 0; db.account_offices.push(OFICINA); apptList.mockReset(); });
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
    db.account_offices.length = 0;
    apptList.mockResolvedValue([{ oficina: 'X', status: 'pendiente', start_time: start, end_time: end }]);
    const svc = new AvailabilityService();
    expect(await svc.hasCapacity('acc1', 'X', start, end)).toBe(false); // 1 solapada >= cap 1
  });
});

describe('AvailabilityService.freeSlots', () => {
  beforeEach(() => { db.account_offices.length = 0; db.account_offices.push({ ...OFICINA, slot_min: 60, capacidad: 1 }); apptList.mockReset(); apptList.mockResolvedValue([]); });

  it('genera slots dentro del horario y días configurados', async () => {
    const svc = new AvailabilityService();
    const slots = await svc.freeSlots('acc1', 'CABA', { now: new Date('2026-06-22T12:00:00.000Z'), max: 3 } as any);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(3);
    const d = (new Date(slots[0].end).getTime() - new Date(slots[0].start).getTime()) / 60000;
    expect(d).toBe(60);
  });

  it('capacidad 2: un slot con 1 cita sigue ofreciéndose; con 2 no', async () => {
    db.account_offices[0] = { ...OFICINA, slot_min: 60, capacidad: 2 };
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

describe('AvailabilityService.availableProfessionals', () => {
  // Lunes 2026-06-22 13:00-14:00 hora local AR (UTC-3) = 16:00-17:00Z
  const start = '2026-06-22T16:00:00.000Z', end = '2026-06-22T17:00:00.000Z';
  const OFI = { id: 'o1', account_id: 'acc1', nombre: 'CABA', modalidad: 'presencial', direccion: 'Av. 1', dias: [1,2,3,4,5], hora_inicio: '09:00', hora_fin: '18:00', slot_min: 60, capacidad: 2, buffer_min: 0, activa: true, orden: 0 };

  beforeEach(() => {
    for (const k of Object.keys(db)) db[k].length = 0;
    apptList.mockReset(); apptList.mockResolvedValue([]);
    db.account_offices.push(OFI);
  });

  it('incluye al prof cuya ventana cubre el slot (dia 1, 09:00-18:00)', async () => {
    db.office_professionals.push({ office_id: 'o1', profile_id: 'p1', activa: true });
    db.professional_availability.push({ profile_id: 'p1', office_id: 'o1', dia: 1, hora_inicio: '09:00', hora_fin: '18:00' });
    const svc = new AvailabilityService();
    expect(await svc.availableProfessionals(OFI as any, start, end)).toEqual(['p1']);
  });

  it('excluye al prof sin ventana ese día', async () => {
    db.office_professionals.push({ office_id: 'o1', profile_id: 'p1', activa: true });
    db.professional_availability.push({ profile_id: 'p1', office_id: 'o1', dia: 2, hora_inicio: '09:00', hora_fin: '18:00' });
    const svc = new AvailabilityService();
    expect(await svc.availableProfessionals(OFI as any, start, end)).toEqual([]);
  });

  it('excluye al prof con bloqueo que solapa', async () => {
    db.office_professionals.push({ office_id: 'o1', profile_id: 'p1', activa: true });
    db.professional_availability.push({ profile_id: 'p1', office_id: 'o1', dia: 1, hora_inicio: '09:00', hora_fin: '18:00' });
    db.professional_blocks.push({ profile_id: 'p1', office_id: null, start_time: '2026-06-22T16:30:00.000Z', end_time: '2026-06-22T17:30:00.000Z' });
    const svc = new AvailabilityService();
    expect(await svc.availableProfessionals(OFI as any, start, end)).toEqual([]);
  });

  it('excluye al prof ya asignado a una cita que solapa', async () => {
    db.office_professionals.push({ office_id: 'o1', profile_id: 'p1', activa: true }, { office_id: 'o1', profile_id: 'p2', activa: true });
    db.professional_availability.push(
      { profile_id: 'p1', office_id: 'o1', dia: 1, hora_inicio: '09:00', hora_fin: '18:00' },
      { profile_id: 'p2', office_id: 'o1', dia: 1, hora_inicio: '09:00', hora_fin: '18:00' },
    );
    apptList.mockResolvedValue([{ oficina: 'CABA', status: 'pendiente', start_time: start, end_time: end, assigned_profile_id: 'p1' }]);
    const svc = new AvailabilityService();
    expect(await svc.availableProfessionals(OFI as any, start, end)).toEqual(['p2']);
  });

  it('devuelve [] si la oficina no tiene profes', async () => {
    const svc = new AvailabilityService();
    expect(await svc.availableProfessionals(OFI as any, start, end)).toEqual([]);
  });
});

describe('AvailabilityService.hasCapacity con profesionales', () => {
  const start = '2026-06-22T16:00:00.000Z', end = '2026-06-22T17:00:00.000Z';
  const OFI = { id: 'o1', account_id: 'acc1', nombre: 'CABA', modalidad: 'presencial', direccion: 'Av. 1', dias: [1,2,3,4,5], hora_inicio: '09:00', hora_fin: '18:00', slot_min: 60, capacidad: 5, buffer_min: 0, activa: true, orden: 0 };

  beforeEach(() => {
    for (const k of Object.keys(db)) db[k].length = 0;
    apptList.mockReset(); apptList.mockResolvedValue([]);
    db.account_offices.push(OFI);
    db.office_professionals.push({ office_id: 'o1', profile_id: 'p1', activa: true });
    db.professional_availability.push({ profile_id: 'p1', office_id: 'o1', dia: 1, hora_inicio: '09:00', hora_fin: '18:00' });
  });

  it('hay cupo si queda al menos un prof libre', async () => {
    const svc = new AvailabilityService();
    expect(await svc.hasCapacity('acc1', 'CABA', start, end)).toBe(true);
  });

  it('no hay cupo si el único prof ya está asignado', async () => {
    apptList.mockResolvedValue([{ oficina: 'CABA', status: 'pendiente', start_time: start, end_time: end, assigned_profile_id: 'p1' }]);
    const svc = new AvailabilityService();
    expect(await svc.hasCapacity('acc1', 'CABA', start, end)).toBe(false);
  });

  it('una cita legacy (sin prof) consume cupo genérico', async () => {
    apptList.mockResolvedValue([{ oficina: 'CABA', status: 'pendiente', start_time: start, end_time: end, assigned_profile_id: null }]);
    const svc = new AvailabilityService(); // 1 prof disponible - 1 legacy = 0 → lleno
    expect(await svc.hasCapacity('acc1', 'CABA', start, end)).toBe(false);
  });

  it('oficina SIN profes usa capacidad fija (fallback)', async () => {
    db.office_professionals.length = 0; db.professional_availability.length = 0;
    apptList.mockResolvedValue([{ oficina: 'CABA', status: 'pendiente', start_time: start, end_time: end, assigned_profile_id: null }]); // 1 < capacidad 5
    const svc = new AvailabilityService();
    expect(await svc.hasCapacity('acc1', 'CABA', start, end)).toBe(true);
  });
});

describe('AvailabilityService.freeSlots TZ del estudio', () => {
  const OFI = { id: 'o1', account_id: 'acc1', nombre: 'CABA', modalidad: 'presencial', direccion: 'Av. 1', dias: [1,2,3,4,5], hora_inicio: '09:00', hora_fin: '18:00', slot_min: 60, capacidad: 5, buffer_min: 0, activa: true, orden: 0 };
  beforeEach(() => {
    for (const k of Object.keys(db)) db[k].length = 0;
    apptList.mockReset(); apptList.mockResolvedValue([]);
    db.account_offices.push(OFI);
    // prof disponible todos los días hábiles 09:00-18:00
    for (const dia of [1,2,3,4,5]) db.professional_availability.push({ profile_id: 'p1', office_id: 'o1', dia, hora_inicio: '09:00', hora_fin: '18:00' });
    db.office_professionals.push({ office_id: 'o1', profile_id: 'p1', activa: true });
  });

  it('los slots empiezan en horas locales del estudio (09:00 ART), no en hora del server', async () => {
    // now = un lunes 06:00 UTC (= 03:00 ART, antes de abrir)
    const now = new Date('2026-06-22T06:00:00.000Z');
    const svc = new AvailabilityService();
    const slots = await svc.freeSlots('acc1', 'CABA', { now, max: 3 });
    expect(slots.length).toBeGreaterThan(0);
    // el primer slot debe caer dentro de 09:00-18:00 hora del estudio
    for (const s of slots) {
      // reconstruct studio-local HH:MM of each slot start via Intl (host-tz independent)
      const local = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(s.start));
      expect(local >= '09:00' && local < '18:00').toBe(true);
    }
    // primer slot exactamente 09:00 ART
    const first = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Argentina/Buenos_Aires', hour12: false, hour: '2-digit', minute: '2-digit' }).format(new Date(slots[0].start));
    expect(first).toBe('09:00');
  });
});

describe('AvailabilityService.pickProfessional', () => {
  const start = '2026-06-22T16:00:00.000Z', end = '2026-06-22T17:00:00.000Z';
  const OFI = { id: 'o1', account_id: 'acc1', nombre: 'CABA', modalidad: 'presencial', direccion: 'Av. 1', dias: [1,2,3,4,5], hora_inicio: '09:00', hora_fin: '18:00', slot_min: 60, capacidad: 5, buffer_min: 0, activa: true, orden: 0 };

  beforeEach(() => {
    for (const k of Object.keys(db)) db[k].length = 0;
    apptList.mockReset(); apptList.mockResolvedValue([]);
    db.account_offices.push(OFI);
    db.office_professionals.push({ office_id: 'o1', profile_id: 'p1', activa: true }, { office_id: 'o1', profile_id: 'p2', activa: true });
    db.professional_availability.push(
      { profile_id: 'p1', office_id: 'o1', dia: 1, hora_inicio: '09:00', hora_fin: '18:00' },
      { profile_id: 'p2', office_id: 'o1', dia: 1, hora_inicio: '09:00', hora_fin: '18:00' },
    );
    db.profiles.push({ id: 'p1', name: 'Ana' }, { id: 'p2', name: 'Beto' });
  });

  it('elige el prof con menos turnos ese día', async () => {
    // p1 ya tiene un turno ese día (en otro horario); p2 ninguno → elige p2
    apptList.mockResolvedValue([{ oficina: 'CABA', status: 'pendiente', start_time: '2026-06-22T13:00:00.000Z', end_time: '2026-06-22T13:30:00.000Z', assigned_profile_id: 'p1' }]);
    const svc = new AvailabilityService();
    expect(await svc.pickProfessional(OFI as any, start, end)).toBe('p2');
  });

  it('empata → desempata por nombre ascendente (Ana < Beto)', async () => {
    const svc = new AvailabilityService(); // ambos con 0 turnos
    expect(await svc.pickProfessional(OFI as any, start, end)).toBe('p1');
  });

  it('devuelve null si no hay prof libre', async () => {
    apptList.mockResolvedValue([
      { oficina: 'CABA', status: 'pendiente', start_time: start, end_time: end, assigned_profile_id: 'p1' },
      { oficina: 'CABA', status: 'pendiente', start_time: start, end_time: end, assigned_profile_id: 'p2' },
    ]);
    const svc = new AvailabilityService();
    expect(await svc.pickProfessional(OFI as any, start, end)).toBeNull();
  });

  it('devuelve null si la oficina no tiene profes', async () => {
    db.office_professionals.length = 0;
    const svc = new AvailabilityService();
    expect(await svc.pickProfessional(OFI as any, start, end)).toBeNull();
  });
});

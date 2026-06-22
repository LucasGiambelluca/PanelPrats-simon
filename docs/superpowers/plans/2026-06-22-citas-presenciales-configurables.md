# Citas presenciales configurables — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hacer las citas configurables por oficina (dirección, días, horario, duración, capacidad) a nivel cuenta, con un `AvailabilityService` único que el agente y los flujos usan para ofrecer slots libres reales y dar la dirección al confirmar.

**Architecture:** Tabla `account_offices` (config por oficina). Un `AvailabilityService` lee esa config y la tabla `appointments` para calcular slots libres respetando capacidad. El agente (tools) y `AppointmentProposalsExecutor` delegan en ese servicio. La integridad de capacidad se garantiza con un trigger Postgres + advisory lock que reemplaza el `EXCLUDE` de capacidad-1 de la migración 0012. CRUD admin por API.

**Tech Stack:** Node/Express + TypeScript, Supabase (Postgres), vitest. Spec: `docs/superpowers/specs/2026-06-22-citas-presenciales-configurables-design.md`.

---

## File Structure

| Archivo | Responsabilidad | Crear/Modificar |
|---|---|---|
| `supabase/migrations/0016_account_offices.sql` | tabla `account_offices` | Crear |
| `supabase/migrations/0017_office_capacity.sql` | trigger de capacidad + advisory lock (reemplaza EXCLUDE 0012) | Crear |
| `server/src/services/AvailabilityService.ts` | config de oficinas + slots libres + capacidad | Crear |
| `server/src/services/AppointmentService.ts` | mapear error del trigger → SLOT_TAKEN | Modificar |
| `server/src/core/agent/runtime/ToolRegistry.ts` | dep `availability`, tool `list_offices`, reescribir `check_availability`, ajustar `book`/`reschedule` | Modificar |
| `server/src/core/agent/runtime/AgentPersona.ts` | reglas de agendado (list_offices → … → dirección) | Modificar |
| `server/src/core/agent/runtime/createAgentRuntime.ts` | inyectar `AvailabilityService` en `ToolRegistry` | Modificar |
| `server/src/core/executors/AppointmentProposalsExecutor.ts` | delegar en `AvailabilityService` (fallback a defaults del nodo) | Modificar |
| `server/src/api/routes/offices.routes.ts` | CRUD admin de oficinas + zod | Crear |
| `server/src/api/app.ts` | montar `/api/offices` | Modificar |

---

## Task 1: Migración 0016 (account_offices)

**Files:** Create `supabase/migrations/0016_account_offices.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0016: config de agenda por oficina/modalidad a nivel cuenta. Idempotente.
CREATE TABLE IF NOT EXISTS account_offices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL,
  nombre       text NOT NULL,
  modalidad    text NOT NULL DEFAULT 'presencial',  -- 'presencial' | 'video'
  direccion    text,
  video_link   text,
  dias         int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  hora_inicio  text NOT NULL DEFAULT '09:00',
  hora_fin     text NOT NULL DEFAULT '18:00',
  slot_min     int  NOT NULL DEFAULT 60,
  capacidad    int  NOT NULL DEFAULT 1,
  buffer_min   int  NOT NULL DEFAULT 0,
  activa       boolean NOT NULL DEFAULT true,
  orden        int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_offices_account ON account_offices(account_id);
ALTER TABLE account_offices ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Type-check** — Run: `cd server && npx tsc --noEmit` → exit 0
- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0016_account_offices.sql
git commit -m "feat(agenda): migración 0016 (account_offices)"
```

---

## Task 2: AvailabilityService — config + capacidad

**Files:**
- Create: `server/src/services/AvailabilityService.ts`
- Test: `server/src/services/__tests__/AvailabilityService.test.ts`

- [ ] **Step 1: Failing test** `server/src/services/__tests__/AvailabilityService.test.ts`

```typescript
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
```

- [ ] **Step 2: Run, verify FAILS** — Run: `cd server && npx vitest run src/services/__tests__/AvailabilityService.test.ts` → "Cannot find module '../AvailabilityService'"

- [ ] **Step 3: Implement** `server/src/services/AvailabilityService.ts`

```typescript
import { supabase } from '../config/supabase';
import { AppointmentService } from './AppointmentService';

export interface Office {
  id: string; account_id: string; nombre: string; modalidad: 'presencial' | 'video';
  direccion?: string | null; video_link?: string | null; dias: number[];
  hora_inicio: string; hora_fin: string; slot_min: number; capacidad: number;
  buffer_min: number; activa: boolean; orden: number;
}
export interface Slot { start: string; end: string; }

const norm = (s: string) => (s || '').trim().toLowerCase();
const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && aEnd > bStart;

export class AvailabilityService {
  async listOffices(accountId: string): Promise<Office[]> {
    const { data } = await supabase.from('account_offices')
      .select('*').eq('account_id', accountId).order('orden', { ascending: true });
    return ((data ?? []) as Office[]).filter((o) => o.activa);
  }

  async getOffice(accountId: string, nombre: string): Promise<Office | null> {
    const list = await this.listOffices(accountId);
    return list.find((o) => norm(o.nombre) === norm(nombre)) ?? null;
  }

  /** Cuenta citas activas de esa oficina que solapan [start,end). */
  private async countOverlap(accountId: string, nombre: string, start: string, end: string): Promise<number> {
    const reqS = new Date(start).getTime(), reqE = new Date(end).getTime();
    const appts = await AppointmentService.list(accountId);
    return appts.filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.end_time &&
      norm(a.oficina || '') === norm(nombre) &&
      overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), reqS, reqE),
    ).length;
  }

  async hasCapacity(accountId: string, nombre: string, start: string, end: string): Promise<boolean> {
    const office = await this.getOffice(accountId, nombre);
    const cap = office?.capacidad ?? 1; // no configurada → 1 (comportamiento viejo)
    const ocupadas = await this.countOverlap(accountId, nombre, start, end);
    return ocupadas < cap;
  }
}
```

- [ ] **Step 4: Run, verify PASSES** — Run: `cd server && npx vitest run src/services/__tests__/AvailabilityService.test.ts` → 5 tests pass
- [ ] **Step 5: Commit**

```bash
git add server/src/services/AvailabilityService.ts server/src/services/__tests__/AvailabilityService.test.ts
git commit -m "feat(agenda): AvailabilityService (oficinas + capacidad)"
```

---

## Task 3: AvailabilityService.freeSlots

**Files:**
- Modify: `server/src/services/AvailabilityService.ts` (agregar `freeSlots`)
- Test: `server/src/services/__tests__/AvailabilityService.test.ts` (agregar casos)

- [ ] **Step 1: Failing test** — agregar al test file:

```typescript
describe('AvailabilityService.freeSlots', () => {
  beforeEach(() => { offices.length = 0; offices.push({ ...OFICINA, slot_min: 60, capacidad: 1 }); apptList.mockReset(); apptList.mockResolvedValue([]); });

  it('genera slots dentro del horario y días configurados', async () => {
    const svc = new AvailabilityService();
    // now fijo: lunes 2026-06-22 08:00 AR (=11:00 UTC). Inyectado para determinismo.
    const slots = await svc.freeSlots('acc1', 'CABA', { now: new Date('2026-06-22T12:00:00.000Z'), max: 3 } as any);
    expect(slots.length).toBeGreaterThan(0);
    expect(slots.length).toBeLessThanOrEqual(3);
    // cada slot dura slot_min (60min)
    const d = (new Date(slots[0].end).getTime() - new Date(slots[0].start).getTime()) / 60000;
    expect(d).toBe(60);
  });

  it('capacidad 2: un slot con 1 cita sigue ofreciéndose; con 2 no', async () => {
    offices[0] = { ...OFICINA, slot_min: 60, capacidad: 2 };
    const now = new Date('2026-06-22T12:00:00.000Z');
    const svc = new AvailabilityService();
    const libres = await svc.freeSlots('acc1', 'CABA', { now, max: 10 } as any);
    const first = libres[0];
    // ocupamos el primer slot con 2 citas → debe desaparecer de la oferta
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
```

- [ ] **Step 2: Run, verify FAILS** — Run: `cd server && npx vitest run src/services/__tests__/AvailabilityService.test.ts` → los nuevos fallan ("freeSlots is not a function")

- [ ] **Step 3: Implement** — agregar a la clase `AvailabilityService` (y exponer la firma con `now` opcional para test/determinismo):

```typescript
  async freeSlots(accountId: string, nombre: string, opts: { desde?: string; hasta?: string; max?: number; now?: Date } = {}): Promise<Slot[]> {
    const office = await this.getOffice(accountId, nombre);
    if (!office) return [];
    const max = opts.max ?? 3;
    const now = opts.now ?? new Date();
    const minStart = new Date(now.getTime() + (office.buffer_min ?? 0) * 60000);

    const [sh, sm] = office.hora_inicio.split(':').map(Number);
    const [eh, em] = office.hora_fin.split(':').map(Number);
    const slotMs = office.slot_min * 60000;

    // Conteo de ocupación por oficina (una sola query), para capacity-check por slot.
    const appts = (await AppointmentService.list(accountId)).filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.end_time && norm(a.oficina || '') === norm(office.nombre));
    const countAt = (s: number, e: number) => appts.filter((a: any) =>
      overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), s, e)).length;

    const out: Slot[] = [];
    for (let dayOffset = 0; dayOffset < 14 && out.length < max; dayOffset++) {
      const day = new Date(now.getTime() + dayOffset * 86400000);
      if (!office.dias.includes(day.getDay())) continue;
      const workStart = new Date(day); workStart.setHours(sh || 9, sm || 0, 0, 0);
      const workEnd = new Date(day); workEnd.setHours(eh || 18, em || 0, 0, 0);

      for (let t = new Date(workStart); t.getTime() + slotMs <= workEnd.getTime() && out.length < max; t = new Date(t.getTime() + slotMs)) {
        const s = t.getTime(), e = s + slotMs;
        if (s < minStart.getTime()) continue;                 // respeta buffer + no pasado
        if (countAt(s, e) >= office.capacidad) continue;      // sin cupo en ese slot
        out.push({ start: new Date(s).toISOString(), end: new Date(e).toISOString() });
      }
    }
    return out;
  }
```

> Nota TZ: el server fija `process.env.TZ='America/Argentina/Buenos_Aires'` (index.ts), así `setHours` es hora AR en prod. Los tests inyectan `now` para determinismo; si tu entorno de test corre en otra TZ y un assert de hora exacta falla, seteá `process.env.TZ` en el test o afirmá duración/capacidad (no la hora de pared).

- [ ] **Step 4: Run, verify PASSES** — Run: `cd server && npx vitest run src/services/__tests__/AvailabilityService.test.ts` → todos verdes (8)
- [ ] **Step 5: Commit**

```bash
git add server/src/services/AvailabilityService.ts server/src/services/__tests__/AvailabilityService.test.ts
git commit -m "feat(agenda): AvailabilityService.freeSlots (grilla + capacidad por slot)"
```

---

## Task 4: Migración 0017 (trigger de capacidad) + mapeo en AppointmentService

**Files:**
- Create: `supabase/migrations/0017_office_capacity.sql`
- Modify: `server/src/services/AppointmentService.ts`
- Test: `server/src/services/__tests__/AppointmentService.capacity.test.ts`

- [ ] **Step 1: Escribir la migración** `supabase/migrations/0017_office_capacity.sql`

```sql
-- 0017: capacidad por oficina. Reemplaza el EXCLUDE de capacidad-1 (0012) por un
-- trigger que cuenta solapamientos contra account_offices.capacidad, con advisory
-- lock por (cuenta, oficina) para serializar reservas y evitar overbooking.
-- Oficina no configurada → capacidad 1 (comportamiento viejo). Idempotente.

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;

CREATE OR REPLACE FUNCTION check_office_capacity() RETURNS trigger AS $$
DECLARE
  cap int;
  ocupadas int;
BEGIN
  IF NEW.status = 'cancelada' OR NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.account_id::text || '|' || lower(coalesce(NEW.oficina, ''))));

  SELECT capacidad INTO cap FROM account_offices
   WHERE account_id = NEW.account_id
     AND lower(nombre) = lower(coalesce(NEW.oficina, '')) AND activa
   LIMIT 1;
  cap := COALESCE(cap, 1);

  SELECT count(*) INTO ocupadas FROM appointments a
   WHERE a.account_id = NEW.account_id
     AND a.id <> NEW.id
     AND a.status <> 'cancelada'
     AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
     AND lower(coalesce(a.oficina, '')) = lower(coalesce(NEW.oficina, ''))
     AND tstzrange(a.start_time, a.end_time) && tstzrange(NEW.start_time, NEW.end_time);

  IF ocupadas >= cap THEN
    RAISE EXCEPTION 'office_capacity_full' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_office_capacity ON appointments;
CREATE TRIGGER trg_office_capacity
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION check_office_capacity();
```

- [ ] **Step 2: Failing test** `server/src/services/__tests__/AppointmentService.capacity.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';

// supabase.from('appointments').insert(...).select().single() → devuelve el error del trigger.
let insertError: any = null;
vi.mock('../../config/supabase', () => ({
  supabase: { from: () => ({
    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: null, error: insertError }) }) }),
    select: () => ({ order: () => ({ eq: () => Promise.resolve({ data: [], error: null }) }) }),
  }) },
}));

import { AppointmentService } from '../AppointmentService';

describe('AppointmentService.create — error del trigger de capacidad', () => {
  it('mapea office_capacity_full → SLOT_TAKEN', async () => {
    insertError = { code: 'P0001', message: 'office_capacity_full' };
    await expect(AppointmentService.create({ account_id: 'acc1', phone: 'p', telefono: 'p', nombre: 'Ana', resumen: '', status: 'pendiente', start_time: '2026-06-22T13:00:00Z', end_time: '2026-06-22T14:00:00Z', oficina: 'CABA' } as any))
      .rejects.toThrow('SLOT_TAKEN');
  });
});
```

> Nota: `AppointmentService.create` primero llama `hasOverlap` (que usa `list`); el mock de `list` devuelve `[]` (sin solape app-level) para que el flujo llegue al insert y dispare el error del trigger.

- [ ] **Step 3: Run, verify FAILS** — Run: `cd server && npx vitest run src/services/__tests__/AppointmentService.capacity.test.ts` → falla (hoy ese error no se mapea a SLOT_TAKEN)

- [ ] **Step 4: Implement** — en `AppointmentService.create`, donde ya maneja el error del insert (busca el bloque `if (error.code === '23P01' || ...)`), ampliar para incluir el error del trigger:

```typescript
      if (error) {
        if (
          error.code === '23P01' ||
          (error.message || '').includes('appointments_no_overlap') ||
          (error.message || '').includes('office_capacity_full')
        ) {
          throw new Error('SLOT_TAKEN');
        }
        throw new Error(error.message);
      }
```

(Hacer el mismo agregado en el manejo de error de `update` si existe un bloque equivalente; si `update` no mapea overlap hoy, agregá el mismo `if` antes de `throw new Error(error.message)`.)

- [ ] **Step 5: Run, verify PASSES** — Run: `cd server && npx vitest run src/services/__tests__/AppointmentService.capacity.test.ts` → pasa
- [ ] **Step 6: tsc + commit**

```bash
cd server && npx tsc --noEmit
git add supabase/migrations/0017_office_capacity.sql server/src/services/AppointmentService.ts server/src/services/__tests__/AppointmentService.capacity.test.ts
git commit -m "feat(agenda): trigger de capacidad (0017) + mapeo office_capacity_full→SLOT_TAKEN"
```

---

## Task 5: ToolRegistry — list_offices + check_availability + book/reschedule con capacidad

**Files:**
- Modify: `server/src/core/agent/runtime/ToolRegistry.ts`
- Test: `server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts`

- [ ] **Step 1: Failing tests** — agregar al test existente. Primero ampliar `makeRegistry()` para inyectar `availability` (stub):

```typescript
const avListOffices = vi.fn();
const avGetOffice = vi.fn();
const avFreeSlots = vi.fn();
const avHasCapacity = vi.fn();
// dentro de makeRegistry(), agregar al objeto deps:
//   availability: { listOffices: avListOffices, getOffice: avGetOffice, freeSlots: avFreeSlots, hasCapacity: avHasCapacity } as any,
```

Tests nuevos:

```typescript
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
```

- [ ] **Step 2: Run, verify FAILS** — Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ToolRegistry.test.ts`

- [ ] **Step 3: Implement** — en `ToolRegistry.ts`:

1. Ampliar `ToolDeps`:
```typescript
import type { AvailabilityService } from '../../../services/AvailabilityService';
export interface ToolDeps {
  appointments: typeof ApptSvc;
  knowledge: KnowledgeBase;
  availability: AvailabilityService;
  handoff: (accountId: string, phone: string, payload: { motivo: string; resumen_caso: string }) => Promise<void>;
}
```

2. Agregar al `SCHEMAS` array el schema de `list_offices` y actualizar el de `check_availability`/`book_appointment` para requerir `oficina`:
```typescript
  { type: 'function', function: { name: 'list_offices', description: 'Lista las oficinas/modalidades del estudio (presencial y video) con su dirección. Usala antes de ofrecer un turno.', parameters: { type: 'object', properties: {} } } },
```
(y en `check_availability` agregá `oficina` a `required`; descripción: "Devuelve horarios LIBRES de una oficina. Llamá list_offices primero." En `book_appointment` agregá `oficina` a `required`.)

3. En `execute`, agregar/reescribir casos:
```typescript
        case 'list_offices': {
          const oficinas = (await this.deps.availability.listOffices(ctx.accountId))
            .map((o) => ({ nombre: o.nombre, modalidad: o.modalidad, direccion: o.direccion ?? null }));
          return { ok: true, data: { oficinas } };
        }
        case 'check_availability': {
          const slots = await this.deps.availability.freeSlots(ctx.accountId, args.oficina, { desde: args.desde, hasta: args.hasta, max: 3 });
          if (!slots.length) {
            const existe = await this.deps.availability.getOffice(ctx.accountId, args.oficina);
            return { ok: true, data: { oficina: args.oficina, slots: [], sin_oficina: !existe } };
          }
          return { ok: true, data: { oficina: args.oficina, slots } };
        }
        case 'book_appointment': {
          if (!(await this.deps.availability.hasCapacity(ctx.accountId, args.oficina, args.start_time, args.end_time))) {
            return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          }
          const appt = await this.deps.appointments.create({
            account_id: ctx.accountId, phone: ctx.phone, telefono: ctx.phone,
            nombre: args.nombre, resumen: args.resumen ?? '', status: 'pendiente',
            start_time: args.start_time, end_time: args.end_time, oficina: args.oficina,
          } as any);
          const office = await this.deps.availability.getOffice(ctx.accountId, args.oficina);
          return { ok: true, data: { appointment_id: appt.id, modalidad: office?.modalidad, direccion: office?.direccion ?? undefined, video_link: office?.video_link ?? undefined } };
        }
```
(`getOffice` ya existe en AvailabilityService; agregalo al type de la dep si hiciera falta.)

4. En `reschedule_appointment` (ya tiene el guard anti-IDOR con `getById`): tras validar ownership, agregar el chequeo de capacidad del nuevo horario usando la oficina de la cita:
```typescript
          if (!(await this.deps.availability.hasCapacity(ctx.accountId, appt.oficina ?? '', args.start_time, args.end_time))) {
            return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          }
```

- [ ] **Step 4: Run, verify PASSES** — Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ToolRegistry.test.ts` → todos verdes
- [ ] **Step 5: tsc + commit**

```bash
cd server && npx tsc --noEmit
git add server/src/core/agent/runtime/ToolRegistry.ts server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts
git commit -m "feat(agenda): tools list_offices + check_availability/book/reschedule con capacidad y dirección"
```

---

## Task 6: Wiring (createAgentRuntime) + persona

**Files:**
- Modify: `server/src/core/agent/runtime/createAgentRuntime.ts`
- Modify: `server/src/core/agent/runtime/AgentPersona.ts`
- Test: `server/src/core/agent/runtime/__tests__/AgentPersona.test.ts`

- [ ] **Step 1: Inyectar AvailabilityService en el ToolRegistry** — en `createAgentRuntime.ts`:
```typescript
import { AvailabilityService } from '../../../services/AvailabilityService';
// ...
  const availability = new AvailabilityService();
  const tools = new ToolRegistry({ appointments: AppointmentService, knowledge, availability, handoff });
```

- [ ] **Step 2: Failing test** — agregar a `AgentPersona.test.ts`:
```typescript
  it('incluye reglas de agendado por oficina (list_offices + dirección)', () => {
    const prompt = buildPersona({ accountId: 'acc1', agentName: 'Sofía' } as any, 'FICHA: nuevo.');
    expect(prompt.toLowerCase()).toContain('list_offices');
    expect(prompt.toLowerCase()).toContain('direcc'); // dar la dirección al confirmar
  });
```

- [ ] **Step 3: Run, verify FAILS** — Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentPersona.test.ts`

- [ ] **Step 4: Implement** — en `AgentPersona.ts`, dentro del bloque de REGLAS, agregar líneas de agendado:
```typescript
    '- Para dar un turno: 1) usá list_offices para ver las oficinas/modalidades, 2) preguntá cuál prefiere, 3) usá check_availability de esa oficina, 4) ofrecé los horarios, 5) confirmá los datos, 6) agendá con book_appointment, 7) al confirmar, dale la dirección (presencial) o el link (video) que devuelve la tool.',
    '- No inventes horarios ni direcciones: usá siempre lo que devuelven las tools.',
```

- [ ] **Step 5: Run, verify PASSES** — Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/AgentPersona.test.ts` → verde
- [ ] **Step 6: tsc + commit**

```bash
cd server && npx tsc --noEmit
git add server/src/core/agent/runtime/createAgentRuntime.ts server/src/core/agent/runtime/AgentPersona.ts server/src/core/agent/runtime/__tests__/AgentPersona.test.ts
git commit -m "feat(agenda): inyectar AvailabilityService + reglas de agendado por oficina en la persona"
```

---

## Task 7: Refactor AppointmentProposalsExecutor (delegar en AvailabilityService)

**Files:**
- Modify: `server/src/core/executors/AppointmentProposalsExecutor.ts`
- Test: `server/src/core/executors/__tests__/AppointmentProposalsExecutor.test.ts`

- [ ] **Step 1: Failing test** — agregar un caso: si la oficina del contexto está configurada en `account_offices`, el executor usa `AvailabilityService.freeSlots` (mockear el servicio) en vez de la lógica del nodo. Agregar al test file (mockear `../../../services/AvailabilityService`):

```typescript
const freeSlots = vi.fn();
vi.mock('../../../services/AvailabilityService', () => ({
  AvailabilityService: class { freeSlots = (...a: any[]) => freeSlots(...a); getOffice = vi.fn(); },
}));

it('si la oficina está configurada, delega los horarios en AvailabilityService', async () => {
  freeSlots.mockResolvedValue([{ start: '2026-06-22T13:00:00.000Z', end: '2026-06-22T14:00:00.000Z' }]);
  const exec = new AppointmentProposalsExecutor();
  const ctx: any = { accountId: 'acc1', oficina: 'CABA' };
  const res = await exec.execute({ oficinaVar: 'oficina', useConfiguredOffice: true }, ctx);
  expect(freeSlots).toHaveBeenCalledWith('acc1', 'CABA', expect.any(Object));
  expect(res.messages[0]).toContain('13:00'); // formateó el slot devuelto
});
```

> Nota: ajustá el assert de hora a la TZ del entorno si hiciera falta; lo esencial es que `freeSlots` se llamó y el mensaje contiene el slot delegado.

- [ ] **Step 2: Run, verify FAILS** — Run: `cd server && npx vitest run src/core/executors/__tests__/AppointmentProposalsExecutor.test.ts`

- [ ] **Step 3: Implement** — en `AppointmentProposalsExecutor.execute`, al inicio, si hay una oficina configurada para la cuenta, delegar:
```typescript
import { AvailabilityService } from '../../services/AvailabilityService';
// ...
    const oficinaVar = nodeData.oficinaVar || 'oficina';
    const oficina = String(nodeData.oficina || (context as any)[oficinaVar] || '').trim();

    if (oficina) {
      const availability = new AvailabilityService();
      const office = await availability.getOffice(context.accountId, oficina);
      if (office) {
        const slots = await availability.freeSlots(context.accountId, oficina, { max: Number(nodeData.maxProposals) || 3 });
        const formatted = this.formatSlots(slots); // extraer el formateo actual a un método privado
        const outputVar = nodeData.outputVariable || 'horarios_disponibles';
        const message = typeof nodeData.text === 'string' && nodeData.text.trim()
          ? nodeData.text.replace(new RegExp(`{{\\s*${outputVar}\\s*}}`, 'g'), formatted)
          : formatted;
        return { messages: [message], wait_for_input: false, updatedContext: { [outputVar]: formatted, [`${outputVar}_array`]: slots } };
      }
    }
    // ... (resto: lógica actual del nodo como FALLBACK cuando la oficina no está configurada)
```
Extraé el bloque de formateo `diasSemana`/`formattedLines` a un método privado `formatSlots(slots: {start;end}[]): string` para reusarlo en ambos caminos (DRY). Mantené intacto el camino fallback (config por `nodeData`) para los flujos que no tengan oficina configurada.

- [ ] **Step 4: Run, verify PASSES** — Run: `cd server && npx vitest run src/core/executors/__tests__/AppointmentProposalsExecutor.test.ts` → verde (delegación + fallback)
- [ ] **Step 5: tsc + commit**

```bash
cd server && npx tsc --noEmit
git add server/src/core/executors/AppointmentProposalsExecutor.ts server/src/core/executors/__tests__/AppointmentProposalsExecutor.test.ts
git commit -m "refactor(agenda): AppointmentProposalsExecutor delega en AvailabilityService (fallback a nodeData)"
```

---

## Task 8: API CRUD de oficinas

**Files:**
- Create: `server/src/api/routes/offices.routes.ts`
- Modify: `server/src/api/app.ts`
- Test: `server/src/api/routes/__tests__/offices.routes.test.ts`

- [ ] **Step 1: Failing test** `server/src/api/routes/__tests__/offices.routes.test.ts`

```typescript
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'o1' }, error: null }) }) }),
  }) },
}));
import { officesRouter } from '../offices.routes';

function getMw(router: any, method: string, path: string, idx: number) {
  const layer = router.stack.find((l: any) => l.route && l.route.methods[method] && l.route.path === path);
  return layer.route.stack[idx].handle;
}
function makeRes() {
  return { statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; } } as any;
}

describe('officesRouter POST validation', () => {
  it('rechaza modalidad inválida (validateBody 400)', () => {
    const validate = getMw(officesRouter(), 'post', '/', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ body: { account_id: 'a', nombre: 'X', modalidad: 'otra', hora_inicio: '09:00', hora_fin: '18:00' } }, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('presencial sin dirección => 400 en el handler', async () => {
    const handler = (() => { const r: any = officesRouter(); const l = r.stack.find((x: any) => x.route?.methods.post && x.route.path === '/'); return l.route.stack[l.route.stack.length - 1].handle; })();
    const res = makeRes();
    await handler({ body: { account_id: 'a', nombre: 'CABA', modalidad: 'presencial', direccion: '', hora_inicio: '09:00', hora_fin: '18:00' } } as any, res);
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Run, verify FAILS** — Run: `cd server && npx vitest run src/api/routes/__tests__/offices.routes.test.ts`

- [ ] **Step 3: Implement** `server/src/api/routes/offices.routes.ts`

```typescript
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../config/supabase';
import { validateBody } from '../middleware/validate';

const createOfficeSchema = z.object({
  account_id: z.string().min(1),
  nombre: z.string().trim().min(1),
  modalidad: z.enum(['presencial', 'video']),
  direccion: z.string().nullish(),
  video_link: z.string().url().nullish(),
  dias: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  hora_inicio: z.string().regex(/^\d{2}:\d{2}$/),
  hora_fin: z.string().regex(/^\d{2}:\d{2}$/),
  slot_min: z.number().int().positive().default(60),
  capacidad: z.number().int().positive().default(1),
  buffer_min: z.number().int().min(0).default(0),
  activa: z.boolean().default(true),
  orden: z.number().int().default(0),
}).strict();
const updateOfficeSchema = createOfficeSchema.partial().strict();

// Validaciones cruzadas que zod no expresa cómodo.
function coherencia(b: any): string | null {
  if (b.modalidad === 'presencial' && !(b.direccion && String(b.direccion).trim())) return 'Una oficina presencial necesita dirección.';
  if (b.hora_inicio && b.hora_fin && b.hora_fin <= b.hora_inicio) return 'hora_fin debe ser posterior a hora_inicio.';
  return null;
}

export function officesRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const accountId = req.query.account_id as string;
    if (!accountId) return res.status(400).json({ error: 'Falta account_id' });
    const { data, error } = await supabase.from('account_offices').select('*').eq('account_id', accountId).order('orden', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  r.post('/', validateBody(createOfficeSchema), async (req, res) => {
    const err = coherencia(req.body);
    if (err) return res.status(400).json({ error: err });
    const { data, error } = await supabase.from('account_offices').insert(req.body).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.put('/:id', validateBody(updateOfficeSchema), async (req, res) => {
    const err = coherencia(req.body);
    if (err) return res.status(400).json({ error: err });
    const { data, error } = await supabase.from('account_offices').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Oficina no encontrada' });
    res.json(data);
  });

  r.delete('/:id', async (req, res) => {
    const { error } = await supabase.from('account_offices').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 4: Montar en `app.ts`** — junto a los routers admin:
```typescript
import { officesRouter } from './routes/offices.routes';
// ...
  app.use('/api/offices', authContext, requireRole('admin'), officesRouter());
```

- [ ] **Step 5: Run, verify PASSES + tsc** — Run: `cd server && npx vitest run src/api/routes/__tests__/offices.routes.test.ts && npx tsc --noEmit`
- [ ] **Step 6: Commit**

```bash
git add server/src/api/routes/offices.routes.ts server/src/api/routes/__tests__/offices.routes.test.ts server/src/api/app.ts
git commit -m "feat(agenda): API CRUD admin de oficinas (/api/offices) con validación"
```

---

## Task 9: Verificación final

**Files:** ninguno (operación).

- [ ] **Step 1: Suite completa + tsc** — Run: `cd server && npx tsc --noEmit && npx vitest run`
  Expected: tsc 0; suite verde. Re-correr aislado el flaky `AppointmentAvailabilityExecutor` si aparece solo en la suite completa.
- [ ] **Step 2: Aplicar migraciones en Supabase** — `0016` y `0017` vía `/config/sync-db` o el SQL editor. Verificar que existe `account_offices` y el trigger `trg_office_capacity`.
- [ ] **Step 3: Seed de oficinas del estudio** — insertar las oficinas reales (CABA, Quilmes, Haedo presencial; Videollamada capacidad 2) para la cuenta piloto vía la API o SQL.
- [ ] **Step 4: Smoke del agente** — con una key de modelo con saldo y `agent_mode='ai_first'` en una cuenta de prueba: pedir un turno presencial y verificar list_offices → horarios reales → confirmación con dirección.

---

## Self-Review (cobertura del spec)
- §2 `account_offices` → Task 1. ✅
- §3 `AvailabilityService` (listOffices/getOffice/freeSlots/hasCapacity) → Tasks 2, 3. ✅
- §4 tools (list_offices, check_availability, book con dirección, reschedule capacidad) → Task 5; persona → Task 6. ✅
- §5 API CRUD admin + zod + coherencia → Task 8. ✅
- §6 trigger 0017 + advisory lock + mapeo SLOT_TAKEN → Task 4. ✅
- §3 refactor del executor (delegar + fallback) → Task 7. ✅
- §7 testing → tests por task; verificación + smoke → Task 9. ✅

**Nota de alcance:** sin pantalla de panel (decisión v1). El seed de oficinas reales y la aplicación de migraciones en Supabase son operativos (Task 9), no de código.

# Agendas por oficina con profesionales — Fase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar la configuración de profesionales (Fase 1) con el motor de agendado: capacidad de slot derivada de profesionales disponibles, auto-asignación de cada reserva a una persona, trigger anti-overbooking por persona, y vistas de agenda por oficina/profesional con reasignación.

**Architecture:** El cálculo de disponibilidad horaria (ventanas + bloqueos) vive en `AvailabilityService` (capa app), que elige el profesional libre. El trigger de DB (`check_office_capacity`, reescrito en 0021) sólo garantiza la invariante dura: una misma persona no puede tener dos citas solapadas, más el fallback de capacidad fija para oficinas sin profesionales. El frontend extiende la página `Agenda.tsx` existente (no se crean páginas nuevas).

**Tech Stack:** Node.js/Express + PostgreSQL (Supabase) + TypeScript + Vitest (backend); React + Vite + Tailwind + sonner + lucide-react (frontend). Spec: `docs/superpowers/specs/2026-06-23-agendas-por-oficina-profesionales-fase2-design.md`.

---

## Notas de arquitectura previas (leer antes de empezar)

- **Migraciones**: viven en `supabase/migrations/`. Se aplican a mano en Supabase cloud (SQL Editor); `DATABASE_URL` del `.env` apunta a localhost (no sirve). Verificación: `node server/scripts/db-audit.js` (REST). Función/trigger NO son verificables por REST → confirmar en SQL Editor.
- **TZ del estudio**: `America/Argentina/Buenos_Aires`. Las ventanas de `professional_availability` se cargan en hora local del estudio (ej. '09:00'); hay que interpretar los `start_time`/`end_time` (ISO/UTC) en esa TZ al comparar contra ventanas y al contar turnos por día. Sin esto, profes y slots se desalinean por el offset (-03).
- **Match oficina↔profes**: `appointments.oficina` es texto; se resuelve a `account_offices.id` por `lower(nombre)` + `account_id` (igual que el trigger 0017).
- **Patrón de tests de rutas**: ver `server/src/api/routes/__tests__/offices.routes.test.ts` (mock de `supabase`, helpers `getMw`/`makeRes`, se invoca el handler directo sin levantar Express).
- **Patrón de tests de servicios**: ver `server/src/services/__tests__/AvailabilityService.test.ts` (mock de `supabase` + `AppointmentService`).
- **Decisión frontend**: ya existe `client/src/pages/Agenda.tsx` (grid propio estilo Google Calendar, ruta `/agenda`, ambos roles, vistas mes/semana/día/lista, modal crear/editar). Fase 2 **extiende** esa página: filtro por profesional, columna/etiqueta de profesional asignado, y reasignación desde el modal. NO se crean `WeekGrid.tsx`/`AssignDropdown.tsx` ni páginas nuevas (sería un grid paralelo redundante).

## File Structure

**Backend:**
- `supabase/migrations/0021_appointment_assigned_professional.sql` — **crear**: columna `assigned_profile_id` + trigger reescrito.
- `server/scripts/db-audit.js` — **modificar**: marcador 0021.
- `server/src/services/AvailabilityService.ts` — **modificar**: TZ helper, helpers de datos de profes, `availableProfessionals`, `hasCapacity` (rewrite), `freeSlots` (rewrite), `pickProfessional`, `officeHasProfessionals`.
- `server/src/services/__tests__/AvailabilityService.test.ts` — **modificar**: mock table-aware + nuevos tests.
- `server/src/services/AppointmentService.ts` — **modificar**: `assigned_profile_id` en interface/deserialize/create/update + mapeo error `professional_busy`.
- `server/src/core/agent/runtime/ToolRegistry.ts` — **modificar**: auto-asignar en `book_appointment` y `reschedule_appointment`.
- `server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts` — **modificar/crear**: tests de auto-asignación.
- `server/src/api/routes/agenda.routes.ts` — **crear**: GET agenda oficina, GET agenda profesional (RBAC), PATCH assign.
- `server/src/api/routes/__tests__/agenda.routes.test.ts` — **crear**: tests de RBAC y assign.
- `server/src/api/app.ts` — **modificar**: montar `agendaRouter`.

**Frontend:**
- `client/src/types.ts` (o donde vivan los tipos) — **modificar**: `Appointment.assigned_profile_id`, tipos de agenda si hacen falta.
- `client/src/lib/api.ts` — **modificar**: `agendaApi` (assign) + extender `Appointment`.
- `client/src/pages/Agenda.tsx` — **modificar**: cargar profesionales, filtro por profesional (admin) / auto-propia (empleada), mostrar profesional en eventos, reasignar desde el modal.

---

## Task 1: Migración 0021 — columna + trigger por profesionales

**Files:**
- Create: `supabase/migrations/0021_appointment_assigned_professional.sql`
- Modify: `server/scripts/db-audit.js`

- [ ] **Step 1: Escribir la migración**

Create `supabase/migrations/0021_appointment_assigned_professional.sql`:

```sql
-- 0021: profesional asignado a una cita + capacidad por profesionales.
-- Reemplaza la función check_office_capacity (0017). Idempotente.
-- La disponibilidad horaria (ventanas/bloqueos) la evalúa AvailabilityService en la app;
-- el trigger sólo garantiza: (1) no-overlap por profesional asignado, (2) fallback de
-- capacidad fija para oficinas SIN profesionales asignados.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS assigned_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appt_assigned_prof
  ON appointments(assigned_profile_id, start_time);

CREATE OR REPLACE FUNCTION check_office_capacity() RETURNS trigger AS $$
DECLARE
  n_profs int;
  cap int;
  ocupadas int;
  solapados int;
BEGIN
  IF NEW.status = 'cancelada' OR NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.account_id::text || '|' || lower(coalesce(NEW.oficina, ''))));

  -- (1) No-overlap por profesional asignado.
  IF NEW.assigned_profile_id IS NOT NULL THEN
    SELECT count(*) INTO solapados FROM appointments a
     WHERE a.account_id = NEW.account_id
       AND a.id <> NEW.id
       AND a.status <> 'cancelada'
       AND a.assigned_profile_id = NEW.assigned_profile_id
       AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
       AND tstzrange(a.start_time, a.end_time) && tstzrange(NEW.start_time, NEW.end_time);
    IF solapados > 0 THEN
      RAISE EXCEPTION 'professional_busy' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (2) Capacidad de oficina: cuántos profes activos tiene.
  SELECT count(*) INTO n_profs
    FROM office_professionals op
    JOIN account_offices o ON o.id = op.office_id
   WHERE op.activa
     AND o.account_id = NEW.account_id
     AND lower(o.nombre) = lower(coalesce(NEW.oficina, ''));

  IF COALESCE(n_profs, 0) = 0 THEN
    -- Fallback modelo viejo: capacidad fija vs solapamientos totales de la oficina.
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
  END IF;
  -- n_profs > 0: la capacidad la garantizan (1) no-overlap por persona + la asignación
  -- previa que ya eligió un prof libre (AvailabilityService). No se recalcula aquí.

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_office_capacity ON appointments;
CREATE TRIGGER trg_office_capacity
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION check_office_capacity();
```

- [ ] **Step 2: Extender db-audit.js con el marcador de 0021**

In `server/scripts/db-audit.js`, dentro del objeto `CHECKS` (después de la línea `'0020_professional_blocks': {...}`), agregar:

```js
  '0021_appointment_assigned_professional': { appointments: ['assigned_profile_id'] },
```

Y en el objeto `NO_REST`, agregar:

```js
  '0021_appointment_assigned_professional': 'function check_office_capacity (reescrita: no-overlap por profesional + fallback fija) + trigger trg_office_capacity',
```

- [ ] **Step 3: Aplicar la migración en Supabase cloud**

Abrir el SQL Editor de Supabase y ejecutar el contenido completo de `0021_appointment_assigned_professional.sql`. Es idempotente (re-ejecutable).

- [ ] **Step 4: Verificar la columna por REST**

Run: `node server/scripts/db-audit.js`
Expected: línea `OK    0021_appointment_assigned_professional`. (La función/trigger aparece bajo "No verificables por REST"; confirmar manualmente en SQL Editor que `trg_office_capacity` existe con `SELECT tgname FROM pg_trigger WHERE tgname='trg_office_capacity';` → 1 fila.)

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0021_appointment_assigned_professional.sql server/scripts/db-audit.js
git commit -m "feat(agenda): migracion 0021 — assigned_profile_id + trigger por profesionales"
```

---

## Task 2: AvailabilityService — TZ helper + helpers de datos + availableProfessionals

**Files:**
- Modify: `server/src/services/AvailabilityService.ts`
- Test: `server/src/services/__tests__/AvailabilityService.test.ts`

- [ ] **Step 1: Reescribir el mock de supabase del test para ser table-aware**

El mock actual devuelve `offices` para cualquier query. Las nuevas consultas tocan `office_professionals`, `professional_availability`, `professional_blocks`, `profiles`. Reemplazar el bloque `vi.mock('../../config/supabase', ...)` (líneas ~5-7) por un mock que rutea por tabla:

```ts
// Datos por tabla que cada test setea. Cada query soporta: select().eq()...(order|maybeSingle|then)
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
```

Actualizar los tests existentes que usaban `offices` para que usen `db.account_offices` (ej. `db.account_offices.push(OFICINA)` en vez de `offices.push(OFICINA)`, y `db.account_offices.length = 0` en los `beforeEach`). Mantener la semántica de los tests previos.

- [ ] **Step 2: Escribir el test de `availableProfessionals`**

Agregar al final de `AvailabilityService.test.ts`:

```ts
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/__tests__/AvailabilityService.test.ts`
Expected: FAIL — `svc.availableProfessionals is not a function`.

- [ ] **Step 4: Implementar el TZ helper y `availableProfessionals`**

En `server/src/services/AvailabilityService.ts`, después de la línea `const overlaps = ...` (línea 13), agregar el helper de TZ:

```ts
const TZ = 'America/Argentina/Buenos_Aires';
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
// Interpreta una fecha en hora local del estudio → { dia: 0-6, hhmm: 'HH:MM' }.
function localParts(d: Date): { dia: number; hhmm: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const wd = parts.find((p) => p.type === 'weekday')!.value;
  let hh = parts.find((p) => p.type === 'hour')!.value;
  const mm = parts.find((p) => p.type === 'minute')!.value;
  if (hh === '24') hh = '00';
  return { dia: WD[wd], hhmm: `${hh}:${mm}` };
}
```

Extender la interface `Office` (ya tiene `id` y `account_id`, no hace falta tocarla). Dentro de la clase `AvailabilityService`, agregar los helpers privados de datos y el método público:

```ts
  /** profile_ids de profes ACTIVOS asignados a la oficina. */
  private async officeProfIds(officeId: string): Promise<string[]> {
    const { data } = await supabase.from('office_professionals')
      .select('profile_id, activa, office_id').eq('office_id', officeId);
    return ((data ?? []) as any[]).filter((r) => r.activa).map((r) => r.profile_id);
  }

  private async windowsForOffice(officeId: string): Promise<Array<{ profile_id: string; dia: number; hora_inicio: string; hora_fin: string }>> {
    const { data } = await supabase.from('professional_availability')
      .select('profile_id, office_id, dia, hora_inicio, hora_fin').eq('office_id', officeId);
    return (data ?? []) as any[];
  }

  private async blocksForOffice(officeId: string): Promise<Array<{ profile_id: string; office_id: string | null; start_time: string; end_time: string }>> {
    // Trae todos los bloqueos; se filtra en memoria por office_id null | officeId.
    const { data } = await supabase.from('professional_blocks')
      .select('profile_id, office_id, start_time, end_time');
    return (data ?? []) as any[];
  }

  async officeHasProfessionals(office: Office): Promise<boolean> {
    return (await this.officeProfIds(office.id)).length > 0;
  }

  /** profile_ids que pueden tomar el slot [start,end): ventana cubre + sin bloqueo + no asignados. */
  async availableProfessionals(office: Office, start: string, end: string): Promise<string[]> {
    const profIds = await this.officeProfIds(office.id);
    if (profIds.length === 0) return [];

    const { dia, hhmm: startHHMM } = localParts(new Date(start));
    const { hhmm: endHHMM } = localParts(new Date(end));
    const windows = await this.windowsForOffice(office.id);
    const withWindow = profIds.filter((pid) =>
      windows.some((w) => w.profile_id === pid && w.dia === dia &&
        w.hora_inicio <= startHHMM && w.hora_fin >= endHHMM));
    if (withWindow.length === 0) return [];

    const s = new Date(start).getTime(), e = new Date(end).getTime();
    const blocks = await this.blocksForOffice(office.id);
    const notBlocked = withWindow.filter((pid) =>
      !blocks.some((b) => b.profile_id === pid &&
        (b.office_id === null || b.office_id === office.id) &&
        new Date(b.start_time).getTime() < e && new Date(b.end_time).getTime() > s));
    if (notBlocked.length === 0) return [];

    const appts = (await AppointmentService.list(office.account_id)).filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.end_time &&
      norm(a.oficina || '') === norm(office.nombre) &&
      overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), s, e));
    const busy = new Set(appts.map((a: any) => a.assigned_profile_id).filter(Boolean));
    return notBlocked.filter((pid) => !busy.has(pid));
  }
```

> Nota: slots que crucen medianoche no están soportados (comparación string HH:MM dentro del mismo día); los horarios del estudio son diurnos. Documentado en el spec.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/__tests__/AvailabilityService.test.ts`
Expected: PASS (incluidos los tests previos migrados a `db.account_offices`).

- [ ] **Step 6: Commit**

```bash
git add server/src/services/AvailabilityService.ts server/src/services/__tests__/AvailabilityService.test.ts
git commit -m "feat(agenda): availableProfessionals + TZ local del estudio"
```

---

## Task 3: AvailabilityService — hasCapacity (rewrite) + freeSlots (rewrite)

**Files:**
- Modify: `server/src/services/AvailabilityService.ts`
- Test: `server/src/services/__tests__/AvailabilityService.test.ts`

- [ ] **Step 1: Escribir los tests de capacidad por profesionales**

Agregar a `AvailabilityService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/__tests__/AvailabilityService.test.ts -t "con profesionales"`
Expected: FAIL — los casos de profesionales dan resultados del modelo viejo (no consideran profes).

- [ ] **Step 3: Reescribir `hasCapacity`, agregar `countLegacyOverlap`, reescribir `freeSlots`**

Reemplazar el método `hasCapacity` (líneas ~38-43) por:

```ts
  /** Cuenta citas solapantes de la oficina con assigned_profile_id null (legacy). */
  private async countLegacyOverlap(accountId: string, nombre: string, start: string, end: string): Promise<number> {
    const reqS = new Date(start).getTime(), reqE = new Date(end).getTime();
    const appts = await AppointmentService.list(accountId);
    return appts.filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.end_time &&
      !a.assigned_profile_id &&
      norm(a.oficina || '') === norm(nombre) &&
      overlaps(new Date(a.start_time).getTime(), new Date(a.end_time).getTime(), reqS, reqE),
    ).length;
  }

  async hasCapacity(accountId: string, nombre: string, start: string, end: string): Promise<boolean> {
    const office = await this.getOffice(accountId, nombre);
    if (!office) {
      // Oficina no configurada → capacidad 1 (comportamiento viejo).
      return (await this.countOverlap(accountId, nombre, start, end)) < 1;
    }
    const profIds = await this.officeProfIds(office.id);
    if (profIds.length === 0) {
      const cap = office.capacidad ?? 1;
      return (await this.countOverlap(accountId, nombre, start, end)) < cap;
    }
    const disponibles = (await this.availableProfessionals(office, start, end)).length;
    const legacy = await this.countLegacyOverlap(accountId, nombre, start, end);
    return disponibles - legacy > 0;
  }
```

Reescribir el cuerpo de `freeSlots` para que el filtro de slot lleno use `hasCapacity` por slot (que ya bifurca profes/fallback). Reemplazar el loop interno (la sección que arma `appts`/`countAt` y el `if (countAt(...) >= office.capacidad) continue;`) por:

```ts
    const out: Slot[] = [];
    for (let dayOffset = 0; dayOffset < 14 && out.length < max; dayOffset++) {
      const day = new Date(now.getTime() + dayOffset * 86400000);
      const { dia } = localParts(day);
      if (!office.dias.includes(dia)) continue;
      const workStart = new Date(day); workStart.setHours(sh || 9, sm || 0, 0, 0);
      const workEnd = new Date(day); workEnd.setHours(eh || 18, em || 0, 0, 0);

      for (let t = new Date(workStart); t.getTime() + slotMs <= workEnd.getTime() && out.length < max; t = new Date(t.getTime() + slotMs)) {
        const s = t.getTime(), e = s + slotMs;
        if (s < minStart.getTime()) continue;
        const startIso = new Date(s).toISOString(), endIso = new Date(e).toISOString();
        if (!(await this.hasCapacity(accountId, office.nombre, startIso, endIso))) continue;
        out.push({ start: startIso, end: endIso });
      }
    }
    return out;
```

> Nota: `freeSlots` ahora usa `localParts(day).dia` en vez de `day.getDay()` para alinear el día de semana con la TZ del estudio. El cómputo de `workStart/workEnd` con `setHours` sigue en hora local del servidor; documentado como follow-up — para el estudio (server en AR o UTC con datos diurnos) es aceptable, y `hasCapacity` ya valida ventanas con TZ correcta.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/__tests__/AvailabilityService.test.ts`
Expected: PASS (todos, incluidos los de Task 2 y los previos).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/AvailabilityService.ts server/src/services/__tests__/AvailabilityService.test.ts
git commit -m "feat(agenda): hasCapacity/freeSlots derivan capacidad de profesionales"
```

---

## Task 4: AvailabilityService — pickProfessional (balance de carga)

**Files:**
- Modify: `server/src/services/AvailabilityService.ts`
- Test: `server/src/services/__tests__/AvailabilityService.test.ts`

- [ ] **Step 1: Escribir el test de `pickProfessional`**

Agregar a `AvailabilityService.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/services/__tests__/AvailabilityService.test.ts -t pickProfessional`
Expected: FAIL — `svc.pickProfessional is not a function`.

- [ ] **Step 3: Implementar `pickProfessional`**

Agregar a la clase `AvailabilityService`:

```ts
  /** Elige el profesional libre con menos turnos ese día (local). Desempate por nombre. */
  async pickProfessional(office: Office, start: string, end: string): Promise<string | null> {
    const cand = await this.availableProfessionals(office, start, end);
    if (cand.length === 0) return null;

    const targetDay = localParts(new Date(start)).dia;
    const appts = (await AppointmentService.list(office.account_id)).filter((a: any) =>
      a.status !== 'cancelada' && a.start_time && a.assigned_profile_id &&
      localParts(new Date(a.start_time)).dia === targetDay);
    const load = new Map<string, number>();
    for (const pid of cand) load.set(pid, 0);
    for (const a of appts) if (load.has(a.assigned_profile_id)) load.set(a.assigned_profile_id, load.get(a.assigned_profile_id)! + 1);

    const { data } = await supabase.from('profiles').select('id, name');
    const nameOf = new Map(((data ?? []) as any[]).map((p) => [p.id, p.name ?? '']));

    return cand.slice().sort((a, b) => {
      const d = (load.get(a) ?? 0) - (load.get(b) ?? 0);
      if (d !== 0) return d;
      return String(nameOf.get(a) ?? '').localeCompare(String(nameOf.get(b) ?? ''));
    })[0];
  }
```

> Nota: el conteo por día usa `dia` de semana (0-6), suficiente para balancear dentro de la ventana de 14 días que ofrece `freeSlots`. Para el volumen del estudio es adecuado.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd server && npx vitest run src/services/__tests__/AvailabilityService.test.ts`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/AvailabilityService.ts server/src/services/__tests__/AvailabilityService.test.ts
git commit -m "feat(agenda): pickProfessional con balance de carga"
```

---

## Task 5: AppointmentService — persistir assigned_profile_id + error professional_busy

**Files:**
- Modify: `server/src/services/AppointmentService.ts`

- [ ] **Step 1: Agregar el campo a la interface y al deserializador**

En `AppointmentService.ts`, en la interface `Appointment` (después de `oficina?: string;`, línea 17), agregar:

```ts
  assigned_profile_id?: string | null; // profesional asignado (Fase 2); null = legacy/pool
```

En `deserializeAppointment`, en la rama de columnas reales (la del `if (app.start_time)`, líneas 42-50), agregar dentro del objeto retornado:

```ts
      assigned_profile_id: app.assigned_profile_id ?? null,
```

Y también en la rama final (texto crudo, el `return {...}` de las líneas 71-78) agregar la misma línea `assigned_profile_id: app.assigned_profile_id ?? null,` (la rama legacy de envelope JSON no la tiene en columna; dejar `null` implícito está bien, pero agregarla explícita en la rama de columnas reales y en la final es lo importante).

- [ ] **Step 2: Persistir en `create`**

En `create`, en el objeto `.insert({...})` (líneas 165-176), agregar:

```ts
          assigned_profile_id: appointment.assigned_profile_id ?? null,
```

- [ ] **Step 3: Persistir en `update` y mapear el error del trigger**

En `update`, en el objeto `.update({...})` (líneas 220-231), agregar:

```ts
          assigned_profile_id: merged.assigned_profile_id ?? null,
```

En el bloque `if (error)` de `update` (líneas 235-244), antes del chequeo de capacidad, agregar el mapeo de `professional_busy`:

```ts
        if ((error.message || '').includes('professional_busy')) {
          throw new Error('PROFESSIONAL_BUSY');
        }
```

(En `create` no hace falta: el book elige un prof libre; si por carrera el trigger lo rechaza, el mapeo de capacidad ya lo convierte en `SLOT_TAKEN`. Para robustez, agregar también en `create` el chequeo `includes('professional_busy')` → `throw new Error('SLOT_TAKEN')` junto a los otros en líneas 182-187.)

- [ ] **Step 4: Verificar typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/AppointmentService.ts
git commit -m "feat(agenda): AppointmentService persiste assigned_profile_id + error professional_busy"
```

---

## Task 6: ToolRegistry — auto-asignar en book y reschedule

**Files:**
- Modify: `server/src/core/agent/runtime/ToolRegistry.ts`
- Test: `server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts`

- [ ] **Step 1: Escribir los tests de auto-asignación**

Agregar al `ToolRegistry.test.ts` (seguir el patrón existente del archivo para construir `deps` y `ctx`; los stubs de `availability` deben incluir los nuevos métodos). Casos:

```ts
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
      appointments: { create: () => Promise.reject(new Error('no debería')) },
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ToolRegistry.test.ts -t auto-asigna`
Expected: FAIL — `book_appointment` aún no llama `officeHasProfessionals`/`pickProfessional`.

- [ ] **Step 3: Reescribir el case `book_appointment`**

Reemplazar el `case 'book_appointment'` (líneas 47-58) por:

```ts
        case 'book_appointment': {
          const office = await this.deps.availability.getOffice(ctx.accountId, args.oficina);
          const hasProfs = office ? await this.deps.availability.officeHasProfessionals(office) : false;
          let assigned: string | null = null;
          if (hasProfs) {
            assigned = await this.deps.availability.pickProfessional(office!, args.start_time, args.end_time);
            if (!assigned) return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          } else if (!(await this.deps.availability.hasCapacity(ctx.accountId, args.oficina, args.start_time, args.end_time))) {
            return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          }
          const appt = await this.deps.appointments.create({
            account_id: ctx.accountId, phone: ctx.phone, telefono: ctx.phone,
            nombre: args.nombre, resumen: args.resumen ?? '', status: 'pendiente',
            start_time: args.start_time, end_time: args.end_time, oficina: args.oficina,
            assigned_profile_id: assigned,
          } as any);
          return { ok: true, data: { appointment_id: appt.id, modalidad: office?.modalidad, direccion: office?.direccion ?? undefined, video_link: office?.video_link ?? undefined } };
        }
```

- [ ] **Step 4: Reescribir el case `reschedule_appointment`**

Reemplazar el `case 'reschedule_appointment'` (líneas 59-69) por:

```ts
        case 'reschedule_appointment': {
          const appt = await this.deps.appointments.getById(args.appointment_id);
          if (!appt || appt.account_id !== ctx.accountId || appt.phone !== ctx.phone) {
            return { ok: false, error: 'No encuentro esa cita a tu nombre.' };
          }
          const office = await this.deps.availability.getOffice(ctx.accountId, appt.oficina ?? '');
          const hasProfs = office ? await this.deps.availability.officeHasProfessionals(office) : false;
          let assigned: string | null = null;
          if (hasProfs) {
            assigned = await this.deps.availability.pickProfessional(office!, args.start_time, args.end_time);
            if (!assigned) return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          } else if (!(await this.deps.availability.hasCapacity(ctx.accountId, appt.oficina ?? '', args.start_time, args.end_time))) {
            return { ok: false, error: 'Ese horario ya no tiene cupo, ofrecé otro.' };
          }
          await this.deps.appointments.update(args.appointment_id, { start_time: args.start_time, end_time: args.end_time, assigned_profile_id: assigned });
          return { ok: true };
        }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd server && npx vitest run src/core/agent/runtime/__tests__/ToolRegistry.test.ts`
Expected: PASS (los nuevos + los previos del archivo).

- [ ] **Step 6: Commit**

```bash
git add server/src/core/agent/runtime/ToolRegistry.ts server/src/core/agent/runtime/__tests__/ToolRegistry.test.ts
git commit -m "feat(agenda): book/reschedule auto-asignan profesional"
```

---

## Task 7: API agenda — oficina, profesional (RBAC) y assign

**Files:**
- Create: `server/src/api/routes/agenda.routes.ts`
- Test: `server/src/api/routes/__tests__/agenda.routes.test.ts`
- Modify: `server/src/api/app.ts`

- [ ] **Step 1: Escribir el router**

Create `server/src/api/routes/agenda.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../config/supabase';
import { AppointmentService } from '../../services/AppointmentService';
import { validateBody } from '../middleware/validate';

const assignSchema = z.object({ profile_id: z.string().uuid().nullable() }).strict();
const MAX_RANGE_MS = 31 * 86400000;

function rango(req: any, res: any): { from: number; to: number } | null {
  const from = Date.parse(req.query.from), to = Date.parse(req.query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) { res.status(400).json({ error: 'from/to ISO requeridos' }); return null; }
  if (to <= from) { res.status(400).json({ error: 'to debe ser posterior a from' }); return null; }
  if (to - from > MAX_RANGE_MS) { res.status(400).json({ error: 'rango máximo 31 días' }); return null; }
  return { from, to };
}

const inRange = (a: any, from: number, to: number) =>
  a.start_time && new Date(a.start_time).getTime() < to && new Date(a.end_time || a.start_time).getTime() > from;

export function agendaRouter(): Router {
  const r = Router();

  // Agenda de una oficina (admin): columnas = profes + citas en rango, separando legacy.
  r.get('/offices/:id', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Sin permiso' });
    const rg = rango(req, res); if (!rg) return;

    const { data: office, error: oErr } = await supabase.from('account_offices')
      .select('id, account_id, nombre').eq('id', req.params.id).maybeSingle();
    if (oErr) return res.status(400).json({ error: oErr.message });
    if (!office) return res.status(404).json({ error: 'Oficina no encontrada' });

    const { data: links } = await supabase.from('office_professionals')
      .select('profile_id, activa').eq('office_id', office.id);
    const profIds = (links ?? []).filter((l: any) => l.activa).map((l: any) => l.profile_id);
    const { data: profs } = await supabase.from('profiles').select('id, name').in('id', profIds.length ? profIds : ['00000000-0000-0000-0000-000000000000']);
    const profesionales = (profs ?? []).map((p: any) => ({ profile_id: p.id, name: p.name }));

    const all = await AppointmentService.list(office.account_id);
    const norm = (s: string) => (s || '').trim().toLowerCase();
    const ofAppts = all.filter((a: any) => norm(a.oficina) === norm(office.nombre) && inRange(a, rg.from, rg.to));
    const appointments = ofAppts.filter((a: any) => a.assigned_profile_id);
    const unassigned = ofAppts.filter((a: any) => !a.assigned_profile_id);
    res.json({ profesionales, appointments, unassigned });
  });

  // Agenda de un profesional (admin cualquiera; empleada solo la propia).
  r.get('/professionals/:id', async (req, res) => {
    if (req.user?.role !== 'admin' && req.user?.id !== req.params.id) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    const accountId = req.query.account_id as string;
    if (!accountId) return res.status(400).json({ error: 'Falta account_id' });
    const rg = rango(req, res); if (!rg) return;
    const all = await AppointmentService.list(accountId);
    const appointments = all.filter((a: any) => a.assigned_profile_id === req.params.id && inRange(a, rg.from, rg.to));
    res.json({ appointments });
  });

  // Reasignar / desasignar una cita (admin).
  r.patch('/appointments/:id/assign', validateBody(assignSchema), async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Sin permiso' });
    try {
      const updated = await AppointmentService.update(req.params.id, { assigned_profile_id: req.body.profile_id });
      res.json(updated);
    } catch (err: any) {
      if (String(err?.message) === 'PROFESSIONAL_BUSY') return res.status(409).json({ error: 'Ese profesional ya tiene una cita solapada.' });
      if (String(err?.message) === 'SLOT_TAKEN') return res.status(409).json({ error: 'Ese horario ya está ocupado.' });
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}
```

- [ ] **Step 2: Escribir los tests**

Create `server/src/api/routes/__tests__/agenda.routes.test.ts` (patrón de `offices.routes.test.ts`):

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'o1', account_id: 'acc1', nombre: 'CABA' }, error: null }) }), in: () => Promise.resolve({ data: [], error: null }) }),
  }) },
}));
const apptUpdate = vi.fn();
vi.mock('../../../services/AppointmentService', () => ({ AppointmentService: { list: () => Promise.resolve([]), update: (...a: any[]) => apptUpdate(...a) } }));

import { agendaRouter } from '../agenda.routes';

function handler(method: string, path: string) {
  const r: any = agendaRouter();
  const l = r.stack.find((x: any) => x.route?.methods[method] && x.route.path === path);
  return l.route.stack[l.route.stack.length - 1].handle;
}
function makeRes() {
  return { statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; } } as any;
}

describe('agendaRouter RBAC', () => {
  it('agenda oficina: 403 si no es admin', async () => {
    const res = makeRes();
    await handler('get', '/offices/:id')({ user: { role: 'empleada', id: 'p1' }, params: { id: 'o1' }, query: {} } as any, res);
    expect(res.statusCode).toBe(403);
  });

  it('agenda profesional: empleada ajena → 403', async () => {
    const res = makeRes();
    await handler('get', '/professionals/:id')({ user: { role: 'empleada', id: 'p1' }, params: { id: 'p2' }, query: { account_id: 'acc1', from: '2026-06-22T00:00:00Z', to: '2026-06-23T00:00:00Z' } } as any, res);
    expect(res.statusCode).toBe(403);
  });

  it('agenda profesional: empleada propia → 200', async () => {
    const res = makeRes();
    await handler('get', '/professionals/:id')({ user: { role: 'empleada', id: 'p1' }, params: { id: 'p1' }, query: { account_id: 'acc1', from: '2026-06-22T00:00:00Z', to: '2026-06-23T00:00:00Z' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.appointments).toEqual([]);
  });

  it('assign: profesional ocupado → 409', async () => {
    apptUpdate.mockRejectedValueOnce(new Error('PROFESSIONAL_BUSY'));
    const res = makeRes();
    await handler('patch', '/appointments/:id/assign')({ user: { role: 'admin' }, params: { id: 'a1' }, body: { profile_id: '11111111-1111-1111-1111-111111111111' } } as any, res);
    expect(res.statusCode).toBe(409);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail then pass**

Run: `cd server && npx vitest run src/api/routes/__tests__/agenda.routes.test.ts`
Expected: primero FAIL si el archivo del router no existe → tras Step 1 PASS.

- [ ] **Step 4: Montar el router en app.ts**

En `server/src/api/app.ts`, después de la línea `app.use('/api/professionals', authContext, requireRole('admin'), professionalsRouter());` (línea 75), agregar (sin `requireRole` global: el RBAC es por-endpoint dentro del router):

```ts
  app.use('/api/agenda', authContext, agendaRouter());
```

Y agregar el import del router junto a los otros imports de routers al inicio del archivo:

```ts
import { agendaRouter } from './routes/agenda.routes';
```

- [ ] **Step 5: Verificar typecheck**

Run: `cd server && npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**

```bash
git add server/src/api/routes/agenda.routes.ts server/src/api/routes/__tests__/agenda.routes.test.ts server/src/api/app.ts
git commit -m "feat(agenda): API agenda oficina/profesional (RBAC) + reasignar cita"
```

---

## Task 8: Cliente — tipos + agendaApi + campo en Appointment

**Files:**
- Modify: `client/src/types.ts`
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Agregar el campo al tipo Appointment del cliente**

Buscar la definición de `Appointment` que exporta `client/src/lib/api.ts` (se importa en Agenda.tsx como `import { ..., Appointment } from '../lib/api'`). Localizarla:

Run: `cd client && npx grep -rn "interface Appointment" src` (o usar el editor)

Agregar el campo opcional a esa interface:

```ts
  assigned_profile_id?: string | null;
```

- [ ] **Step 2: Agregar `agendaApi`**

En `client/src/lib/api.ts`, después de `professionalsApi` (línea ~293), agregar:

```ts
export const agendaApi = {
  office: (officeId: string, from: string, to: string) =>
    api<{ profesionales: { profile_id: string; name: string }[]; appointments: Appointment[]; unassigned: Appointment[] }>(
      `/api/agenda/offices/${officeId}?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  professional: (profileId: string, accountId: string, from: string, to: string) =>
    api<{ appointments: Appointment[] }>(
      `/api/agenda/professionals/${profileId}?account_id=${encodeURIComponent(accountId)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
  assign: (appointmentId: string, profileId: string | null) =>
    api<Appointment>(`/api/agenda/appointments/${appointmentId}/assign`, { method: 'PATCH', body: JSON.stringify({ profile_id: profileId }) }),
};
```

(Si `Appointment` no está en scope en ese punto del archivo, importarla/referenciarla según cómo esté exportada — está definida en el mismo `api.ts`.)

- [ ] **Step 3: Verificar typecheck del cliente**

Run: `cd client && npx tsc --noEmit`
Expected: exit 0 (ignorar los 2 errores preexistentes de `WhatsAppInbox.tsx` si aparecen; ver Task 10).

- [ ] **Step 4: Commit**

```bash
git add client/src/lib/api.ts client/src/types.ts
git commit -m "feat(agenda): cliente — tipo assigned_profile_id + agendaApi"
```

---

## Task 9: Frontend — extender Agenda.tsx (filtro profesional + reasignar)

**Files:**
- Modify: `client/src/pages/Agenda.tsx`

Esta página ya carga y muestra todas las citas (grid mes/semana/día/lista + modal). Fase 2 agrega: (a) cargar profesionales, (b) filtro por profesional, con empleada bloqueada a la propia, (c) etiqueta del profesional asignado en el modal con selector para reasignar.

- [ ] **Step 1: Importar deps y cargar profesionales + rol**

En los imports de `Agenda.tsx`, agregar:

```ts
import { professionalsApi, agendaApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
```

(Verificar el nombre real del hook de auth en `client/src/context/AuthContext.tsx` — usar el que exporte, p.ej. `useAuth`.)

Dentro del componente `Agenda`, junto a los otros `useState`, agregar:

```ts
  const { user } = useAuth(); // { id, role, name }
  const [professionals, setProfessionals] = useState<{ id: string; name: string; role: string }[]>([]);
  const [profFilter, setProfFilter] = useState<string>(''); // '' = todos
```

Y un efecto para cargar profesionales (solo admin; la empleada se filtra a sí misma):

```ts
  useEffect(() => {
    if (user?.role === 'admin') {
      professionalsApi.list().then(setProfessionals).catch(() => {});
    } else if (user) {
      setProfFilter(user.id); // empleada: agenda propia
    }
  }, [user]);
```

- [ ] **Step 2: Aplicar el filtro de profesional al listado**

En el `filteredAppointments` (línea ~175), agregar la condición de profesional al `return` final. Cambiar:

```ts
    return matchesSearch && matchesStatusFilter;
```

por:

```ts
    const matchesProf = !profFilter || app.assigned_profile_id === profFilter;
    return matchesSearch && matchesStatusFilter && matchesProf;
```

- [ ] **Step 3: Agregar el selector de profesional en el header (solo admin)**

En el header, junto al View Switcher (cerca de la línea ~841), agregar para admin un `<select>` de profesional:

```tsx
            {user?.role === 'admin' && (
              <select
                value={profFilter}
                onChange={(e) => setProfFilter(e.target.value)}
                className={`border rounded-xl px-3 py-1.5 text-xs font-bold ${theme === 'light' ? 'bg-slate-100 border-slate-200 text-slate-700' : 'bg-white/5 border-white/10 text-brand-textLight'}`}
                title="Filtrar por profesional"
              >
                <option value="">Todos los profesionales</option>
                <option value="__none__" disabled>──────────</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
```

(El item separador es cosmético; si molesta, omitirlo. La opción "Sin asignar" no se incluye porque `profFilter` filtra por igualdad de id; para ver legacy se usa "Todos".)

- [ ] **Step 4: Reasignar profesional desde el modal de edición**

En el modal (cita existente, `selectedApp`), agregar un selector de profesional + handler. Primero, un handler junto a los otros (`handleUpdateStatus`, etc.):

```ts
  const handleAssign = async (appointmentId: string, profileId: string | null) => {
    try {
      await agendaApi.assign(appointmentId, profileId);
      toast.success(profileId ? 'Profesional asignado' : 'Cita sin asignar');
      loadAppointments(true);
      setSelectedApp((prev) => prev ? { ...prev, assigned_profile_id: profileId } : prev);
    } catch (err: any) {
      toast.error('No se pudo reasignar: ' + err.message);
    }
  };
```

En el modal, dentro del bloque `{selectedApp && (...)}` (cerca del bloque "Llamar / Videollamar", línea ~1527), agregar antes de él un selector visible solo para admin:

```tsx
              {selectedApp && user?.role === 'admin' && (
                <div className="space-y-1">
                  <label className={`text-[10px] font-bold uppercase tracking-wider flex items-center gap-1 ${theme === 'light' ? 'text-brand-inkmuted' : 'text-brand-secondary/80'}`}>
                    <User size={10} />
                    <span>Profesional asignado</span>
                  </label>
                  <select
                    value={selectedApp.assigned_profile_id ?? ''}
                    onChange={(e) => handleAssign(selectedApp.id, e.target.value || null)}
                    className={`w-full border rounded-xl px-3 py-2 text-xs ${theme === 'light' ? 'bg-brand-ivory border-brand-hairline text-brand-ink' : 'bg-brand-dark/60 border-white/10 text-white'}`}
                  >
                    <option value="">Sin asignar</option>
                    {professionals.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </div>
              )}
```

- [ ] **Step 5: Mostrar el nombre del profesional en los eventos (opcional, list view)**

En la list view, en la tarjeta de cada cita (cerca del teléfono, línea ~1192), agregar el nombre del profesional si está asignado:

```tsx
                            {app.assigned_profile_id && (
                              <div className={`text-[10px] mt-1 ${theme === 'light' ? 'text-brand-primary' : 'text-brand-secondary'}`}>
                                {professionals.find((p) => p.id === app.assigned_profile_id)?.name || 'Asignada'}
                              </div>
                            )}
```

(Para empleada, `professionals` está vacío → mostrará "Asignada"; aceptable. Si se quiere el nombre también para empleada, cargar `professionalsApi.list()` para ambos roles en Step 1; es admin-only en el backend, así que mantener admin-only y "Asignada" como fallback.)

- [ ] **Step 6: Verificar build del cliente**

Run: `cd client && npx tsc --noEmit`
Expected: exit 0 salvo los 2 errores preexistentes de `WhatsAppInbox.tsx` (ver Task 10). Los cambios de Agenda.tsx no deben sumar errores.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Agenda.tsx
git commit -m "feat(agenda): filtro por profesional + reasignar desde la agenda"
```

---

## Task 10: Cierre — typecheck, suite completa, build y verificación

**Files:** (verificación; sin cambios de feature salvo el fix de build)

- [ ] **Step 1: Suite de tests del backend**

Run: `cd server && npx vitest run`
Expected: PASS. Si `AppointmentAvailabilityExecutor` falla por aislamiento (flaky conocido), correrlo aislado: `npx vitest run src/core/executors/__tests__/AppointmentAvailabilityExecutor.test.ts`. Documentar cualquier falla real.

- [ ] **Step 2: Typecheck backend y cliente**

Run: `cd server && npx tsc --noEmit` → exit 0.
Run: `cd client && npx tsc --noEmit` → reporta solo los 2 errores preexistentes de `WhatsAppInbox.tsx`.

- [ ] **Step 3: Decidir el fix de WhatsAppInbox.tsx (build roto preexistente)**

`client/src/pages/WhatsAppInbox.tsx` tiene 2 errores tsc ajenos a Fase 2 que rompen `npm run build`. Leer los errores (`npx tsc --noEmit` los lista con archivo:línea), arreglarlos mínimamente para que `npm run build` pase, y commitear aparte:

```bash
git add client/src/pages/WhatsAppInbox.tsx
git commit -m "fix(inbox): corrige 2 errores tsc que rompian el build"
```

(Si el fix no es trivial/seguro, NO bloquear Fase 2: dejar registrado y seguir. El build de Fase 2 en sí no depende de ese archivo.)

- [ ] **Step 4: Build del cliente**

Run: `cd client && npm run build`
Expected: build OK (tras Step 3).

- [ ] **Step 5: Verificación funcional manual (smoke)**

Con `agent_mode='ai_first'` + key con saldo en una cuenta de test, y una oficina con ≥1 profesional con horario cargado:
1. Reservar un turno vía agente/flow → la cita aparece con un profesional asignado en `GET /api/agenda/offices/:id`.
2. Llenar todos los profes de un slot → el agente ofrece otro horario (sin cupo).
3. Desde la página Agenda (admin): filtrar por ese profesional → ver la cita; reasignar a otro profesional libre → toast de éxito; reasignar a uno ocupado en el mismo horario → toast de error (409 professional_busy).
4. Como empleada: entrar a `/agenda` → ver solo las citas propias.

- [ ] **Step 6: Actualizar memoria del proyecto**

Actualizar `C:\Users\Lucas\.claude\projects\C--Users-Lucas-Desktop-nuevo-panel\memory\agente-y-agenda-features.md`: registrar Fase 2 implementada (migración 0021 aplicada, capacidad por profes, auto-asignación, agenda con reasignación), y mover a "follow-up" lo que quede (TZ de `workStart/workEnd` en `freeSlots`).

---

## Self-Review (cobertura del spec)

- **Modelo de datos (0021 + índice)** → Task 1. ✔
- **Trigger nuevo (no-overlap por persona + fallback fija)** → Task 1. ✔
- **AvailabilityService: availableProfessionals / hasCapacity / freeSlots / pickProfessional / officeHasProfessionals / TZ** → Tasks 2-4. ✔
- **AppointmentService persiste assigned_profile_id + error professional_busy** → Task 5. ✔
- **Tools del agente (book/reschedule auto-asignan, check_availability vía freeSlots)** → Task 6 (check_availability ya usa freeSlots reescrito en Task 3). ✔
- **API: /agenda/offices/:id, /agenda/professionals/:id (RBAC), PATCH assign** → Task 7. ✔
- **Frontend: filtro por profesional, agenda personal (empleada), reasignar** → Tasks 8-9 (extiende Agenda.tsx existente en vez de WeekGrid/AssignDropdown nuevos — desviación documentada del spec por descubrimiento de la página existente). ✔
- **Testing (servicio, trigger via tests de unidad, API, migración/db-audit)** → Tasks 2-7, 10. El trigger SQL se valida funcionalmente en el smoke (Step 5 de Task 10), ya que el harness Vitest no levanta Postgres; la lógica de capacidad de la app se cubre con unit tests. ✔
- **Manejo de errores (409 professional_busy, sin cupo)** → Tasks 5-7. ✔

Desviaciones respecto del spec: (1) frontend extiende `Agenda.tsx` en lugar de crear `WeekGrid.tsx`/`AssignDropdown.tsx` y página nueva — la página ya existe con grid propio; crear un paralelo sería redundante. (2) Las tres rutas de agenda se agrupan en un único `agendaRouter` bajo `/api/agenda` con RBAC por-endpoint (en vez de repartirlas en officesRouter/appointmentsRouter), para tener una sola superficie de RBAC mixto admin/empleada.

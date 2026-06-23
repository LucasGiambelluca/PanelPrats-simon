# Agendas por oficina con profesionales — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que un admin cargue oficinas, les asigne profesionales (empleados), y configure el horario base y los bloqueos de cada profesional por oficina, desde una UI en el panel.

**Architecture:** Tres tablas nuevas en Supabase (`office_professionals`, `professional_availability`, `professional_blocks`). Dos routers Express nuevos bajo `requireRole('admin')`, siguiendo el patrón de `offices.routes.ts` (Express + Zod + supabase service client). Una página React nueva (`Offices.tsx`) con un panel de detalle, usando los patrones de `Team.tsx` (Tailwind `brand-*`, `sonner`, `lucide-react`) y el `AccountContext` existente para la cuenta activa. NO se toca el motor de agendado ni el agente (Fase 2).

**Tech Stack:** Node/Express/TypeScript, Zod, Supabase (postgres), Vitest (backend). React 18 + Vite + TypeScript + TailwindCSS + react-router + sonner + lucide-react (frontend, sin runner de tests → verificación por build TS + smoke manual).

**Spec:** `docs/superpowers/specs/2026-06-23-agendas-por-oficina-profesionales-fase1-design.md`

**Convención de día:** `0-6` (0=domingo … 6=sábado), igual que `account_offices.dias` y `Date.getDay()`.

---

## File Structure

**Backend (crear):**
- `supabase/migrations/0018_office_professionals.sql` — tabla asignación.
- `supabase/migrations/0019_professional_availability.sql` — horario base.
- `supabase/migrations/0020_professional_blocks.sql` — bloqueos.
- `server/src/api/routes/office-professionals.routes.ts` — sub-rutas `/:id/professionals` bajo `/api/offices`.
- `server/src/api/routes/professionals.routes.ts` — `/api/professionals` (list + availability + blocks).
- `server/src/api/routes/__tests__/office-professionals.routes.test.ts`
- `server/src/api/routes/__tests__/professionals.routes.test.ts`

**Backend (modificar):**
- `server/src/api/app.ts:71` — montar los dos routers nuevos.
- `server/scripts/db-audit.js` — agregar marcadores de las 3 tablas nuevas.

**Frontend (crear):**
- `client/src/pages/Offices.tsx` — página lista + alta/edición de oficina.
- `client/src/components/offices/OfficeDetail.tsx` — panel detalle: profesionales + disponibilidad + bloqueos.

**Frontend (modificar):**
- `client/src/types/index.ts` — tipos nuevos.
- `client/src/lib/api.ts` — `officesApi`, `professionalsApi`.
- `client/src/App.tsx:23,68` — lazy import + ruta admin.
- `client/src/components/Layout.tsx:5,7-15` — ítem de nav "Oficinas".

---

## Task 1: Migraciones (3 tablas nuevas)

**Files:**
- Create: `supabase/migrations/0018_office_professionals.sql`
- Create: `supabase/migrations/0019_professional_availability.sql`
- Create: `supabase/migrations/0020_professional_blocks.sql`

- [ ] **Step 1: Crear 0018_office_professionals.sql**

```sql
-- 0018: asignación profesional <-> oficina. Idempotente.
CREATE TABLE IF NOT EXISTS office_professionals (
  office_id   uuid NOT NULL REFERENCES account_offices(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activa      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (office_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_office_prof_profile ON office_professionals(profile_id);
ALTER TABLE office_professionals ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 2: Crear 0019_professional_availability.sql**

```sql
-- 0019: horario base semanal de un profesional en una oficina. Idempotente.
-- Varias filas por (profile_id, office_id, dia) = varias ventanas (ej. 09-12 y 15-18).
CREATE TABLE IF NOT EXISTS professional_availability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  office_id    uuid NOT NULL REFERENCES account_offices(id) ON DELETE CASCADE,
  dia          smallint NOT NULL CHECK (dia BETWEEN 0 AND 6),
  hora_inicio  text NOT NULL,
  hora_fin     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_avail_office  ON professional_availability(office_id);
CREATE INDEX IF NOT EXISTS idx_prof_avail_profile ON professional_availability(profile_id);
ALTER TABLE professional_availability ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 3: Crear 0020_professional_blocks.sql**

```sql
-- 0020: bloqueos puntuales de un profesional (vacaciones/ocupado). Idempotente.
-- office_id NULL = bloquea en todas las oficinas del profesional.
CREATE TABLE IF NOT EXISTS professional_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  office_id   uuid REFERENCES account_offices(id) ON DELETE CASCADE,
  start_time  timestamptz NOT NULL,
  end_time    timestamptz NOT NULL,
  motivo      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_prof_blocks_profile ON professional_blocks(profile_id);
ALTER TABLE professional_blocks ENABLE ROW LEVEL SECURITY;
```

- [ ] **Step 4: Aplicar en Supabase y verificar**

Aplicar los 3 `.sql` en el SQL Editor de Supabase (la DB de `DATABASE_URL` es localhost y está caída; no sirve `apply-migration.js`). Luego verificar:

```sql
select
  (select count(*) from information_schema.tables where table_name='office_professionals')       as t18,
  (select count(*) from information_schema.tables where table_name='professional_availability')  as t19,
  (select count(*) from information_schema.tables where table_name='professional_blocks')        as t20;
```
Expected: `1, 1, 1`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0018_office_professionals.sql supabase/migrations/0019_professional_availability.sql supabase/migrations/0020_professional_blocks.sql
git commit -m "feat(agenda): migraciones 0018-0020 oficina-profesionales, disponibilidad y bloqueos"
```

---

## Task 2: Extender db-audit.js con las tablas nuevas

**Files:**
- Modify: `server/scripts/db-audit.js` (objeto `CHECKS`)

- [ ] **Step 1: Agregar marcadores**

En `server/scripts/db-audit.js`, dentro del objeto `CHECKS`, después de la entrada `'0017_office_capacity'`, agregar:

```js
  '0018_office_professionals': { office_professionals: ['office_id', 'profile_id', 'activa'] },
  '0019_professional_availability': { professional_availability: ['id', 'profile_id', 'office_id', 'dia', 'hora_inicio', 'hora_fin'] },
  '0020_professional_blocks': { professional_blocks: ['id', 'profile_id', 'office_id', 'start_time', 'end_time'] },
```

(El `db-audit.js` actual es la versión REST: solo hay que extender el objeto `CHECKS` con el formato `tabla: [columnas]`. No hay lista `known` que tocar.)

- [ ] **Step 2: Correr la auditoría**

Run: `cd server && node scripts/db-audit.js`
Expected: líneas `OK 0018_office_professionals`, `OK 0019_professional_availability`, `OK 0020_professional_blocks` (si ya aplicaste Task 1 Step 4). Si no aplicaste, mostrará `FALTA` — es correcto hasta aplicar.

- [ ] **Step 3: Commit**

```bash
git add server/scripts/db-audit.js
git commit -m "chore(agenda): db-audit cubre tablas 0018-0020"
```

---

## Task 3: Router office-professionals (asignar/quitar profesionales a una oficina)

**Files:**
- Create: `server/src/api/routes/office-professionals.routes.ts`
- Test: `server/src/api/routes/__tests__/office-professionals.routes.test.ts`
- Modify: `server/src/api/app.ts:71`

- [ ] **Step 1: Escribir el test (validación de asignación)**

Crear `server/src/api/routes/__tests__/office-professionals.routes.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { office_id: 'o1', profile_id: 'p1', activa: true }, error: null }) }) }),
  }) },
}));
import { officeProfessionalsRouter } from '../office-professionals.routes';

function getMw(router: any, method: string, path: string, idx: number) {
  const layer = router.stack.find((l: any) => l.route && l.route.methods[method] && l.route.path === path);
  return layer.route.stack[idx].handle;
}
function makeRes() {
  return { statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; } } as any;
}

describe('officeProfessionalsRouter POST validation', () => {
  it('rechaza profile_id no-uuid (validateBody 400)', () => {
    const validate = getMw(officeProfessionalsRouter(), 'post', '/:id/professionals', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ params: { id: 'o1' }, body: { profile_id: 'no-uuid' } }, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd server && npx vitest run src/api/routes/__tests__/office-professionals.routes.test.ts`
Expected: FAIL — `Cannot find module '../office-professionals.routes'`.

- [ ] **Step 3: Implementar el router**

Crear `server/src/api/routes/office-professionals.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../config/supabase';
import { validateBody } from '../middleware/validate';

const assignSchema = z.object({ profile_id: z.string().uuid() }).strict();

// Monta sub-rutas bajo /api/offices: /:id/professionals.
export function officeProfessionalsRouter(): Router {
  const r = Router();

  // Profesionales asignados a una oficina (con nombre del profile).
  r.get('/:id/professionals', async (req, res) => {
    const { data, error } = await supabase
      .from('office_professionals')
      .select('profile_id, activa, profiles(name, role)')
      .eq('office_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    const out = (data ?? []).map((row: any) => ({
      profile_id: row.profile_id,
      activa: row.activa,
      name: row.profiles?.name ?? null,
      role: row.profiles?.role ?? null,
    }));
    res.json(out);
  });

  // Asignar (idempotente: upsert por PK office_id+profile_id).
  r.post('/:id/professionals', validateBody(assignSchema), async (req, res) => {
    const row = { office_id: req.params.id, profile_id: req.body.profile_id, activa: true };
    const { data, error } = await supabase
      .from('office_professionals')
      .upsert(row, { onConflict: 'office_id,profile_id' })
      .select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // Quitar.
  r.delete('/:id/professionals/:profileId', async (req, res) => {
    const { data, error } = await supabase
      .from('office_professionals')
      .delete()
      .eq('office_id', req.params.id).eq('profile_id', req.params.profileId)
      .select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Asignación no encontrada' });
    res.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd server && npx vitest run src/api/routes/__tests__/office-professionals.routes.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Montar en app.ts**

En `server/src/api/app.ts`, después de la línea 71 (`app.use('/api/offices', authContext, requireRole('admin'), officesRouter());`), agregar:

```ts
app.use('/api/offices', authContext, requireRole('admin'), officeProfessionalsRouter());
```

Y agregar el import junto a la línea 17:

```ts
import { officeProfessionalsRouter } from './routes/office-professionals.routes';
```

- [ ] **Step 6: Verificar build**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add server/src/api/routes/office-professionals.routes.ts server/src/api/routes/__tests__/office-professionals.routes.test.ts server/src/api/app.ts
git commit -m "feat(agenda): API asignar/quitar profesionales a oficina"
```

---

## Task 4: Router professionals (list + disponibilidad + bloqueos)

**Files:**
- Create: `server/src/api/routes/professionals.routes.ts`
- Test: `server/src/api/routes/__tests__/professionals.routes.test.ts`
- Modify: `server/src/api/app.ts`

- [ ] **Step 1: Escribir el test (validación de ventanas y bloqueos)**

Crear `server/src/api/routes/__tests__/professionals.routes.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
  }) },
}));
import { professionalsRouter } from '../professionals.routes';

function getMw(router: any, method: string, path: string, idx: number) {
  const layer = router.stack.find((l: any) => l.route && l.route.methods[method] && l.route.path === path);
  return layer.route.stack[idx].handle;
}
function makeRes() {
  return { statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; } } as any;
}

describe('professionalsRouter validation', () => {
  it('PUT availability rechaza ventana con hora_fin <= hora_inicio', () => {
    const validate = getMw(professionalsRouter(), 'put', '/:id/availability', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ params: { id: 'p1' }, query: { office_id: 'o1' },
      body: { ventanas: [{ dia: 1, hora_inicio: '18:00', hora_fin: '09:00' }] } }, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('PUT availability rechaza dia fuera de 0-6', () => {
    const validate = getMw(professionalsRouter(), 'put', '/:id/availability', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ params: { id: 'p1' }, query: { office_id: 'o1' },
      body: { ventanas: [{ dia: 9, hora_inicio: '09:00', hora_fin: '18:00' }] } }, res, next);
    expect(res.statusCode).toBe(400);
  });

  it('POST block rechaza end_time <= start_time', () => {
    const validate = getMw(professionalsRouter(), 'post', '/:id/blocks', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ params: { id: 'p1' },
      body: { start_time: '2026-07-01T15:00:00Z', end_time: '2026-07-01T14:00:00Z' } }, res, next);
    expect(res.statusCode).toBe(400);
  });

  it('POST block acepta rango válido sin office_id', () => {
    const validate = getMw(professionalsRouter(), 'post', '/:id/blocks', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ params: { id: 'p1' },
      body: { start_time: '2026-07-01T14:00:00Z', end_time: '2026-07-01T16:00:00Z', motivo: 'vacaciones' } }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });
});
```

- [ ] **Step 2: Correr el test (debe fallar)**

Run: `cd server && npx vitest run src/api/routes/__tests__/professionals.routes.test.ts`
Expected: FAIL — `Cannot find module '../professionals.routes'`.

- [ ] **Step 3: Implementar el router**

Crear `server/src/api/routes/professionals.routes.ts`:

```ts
import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../config/supabase';
import { validateBody } from '../middleware/validate';

const HHMM = /^\d{2}:\d{2}$/;

const ventanaSchema = z.object({
  dia: z.number().int().min(0).max(6),
  hora_inicio: z.string().regex(HHMM),
  hora_fin: z.string().regex(HHMM),
}).strict().refine((v) => v.hora_fin > v.hora_inicio, { message: 'hora_fin debe ser posterior a hora_inicio' });

const availabilityPutSchema = z.object({ ventanas: z.array(ventanaSchema) }).strict();

const blockSchema = z.object({
  office_id: z.string().uuid().nullish(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  motivo: z.string().nullish(),
}).strict().refine((b) => new Date(b.end_time) > new Date(b.start_time), { message: 'end_time debe ser posterior a start_time' });

export function professionalsRouter(): Router {
  const r = Router();

  // Profesionales asignables = profiles activos (incluye admin). Solo id/name/role.
  r.get('/', async (_req, res) => {
    const { data, error } = await supabase
      .from('profiles').select('id, name, role')
      .eq('active', true).order('name', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  // Disponibilidad de un profesional en una oficina.
  r.get('/:id/availability', async (req, res) => {
    const officeId = req.query.office_id as string;
    if (!officeId) return res.status(400).json({ error: 'Falta office_id' });
    const { data, error } = await supabase
      .from('professional_availability')
      .select('id, dia, hora_inicio, hora_fin')
      .eq('profile_id', req.params.id).eq('office_id', officeId)
      .order('dia', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  // Reemplaza el set completo de ventanas (profile_id, office_id).
  r.put('/:id/availability', validateBody(availabilityPutSchema), async (req, res) => {
    const officeId = req.query.office_id as string;
    if (!officeId) return res.status(400).json({ error: 'Falta office_id' });
    const { error: delErr } = await supabase
      .from('professional_availability')
      .delete().eq('profile_id', req.params.id).eq('office_id', officeId);
    if (delErr) return res.status(400).json({ error: delErr.message });
    const rows = (req.body.ventanas as any[]).map((v) => ({
      profile_id: req.params.id, office_id: officeId,
      dia: v.dia, hora_inicio: v.hora_inicio, hora_fin: v.hora_fin,
    }));
    if (rows.length === 0) return res.json([]);
    const { data, error } = await supabase
      .from('professional_availability').insert(rows).select('id, dia, hora_inicio, hora_fin');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  // Bloqueos de un profesional.
  r.get('/:id/blocks', async (req, res) => {
    const { data, error } = await supabase
      .from('professional_blocks')
      .select('id, office_id, start_time, end_time, motivo')
      .eq('profile_id', req.params.id)
      .order('start_time', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  r.post('/:id/blocks', validateBody(blockSchema), async (req, res) => {
    const row = { profile_id: req.params.id, ...req.body };
    const { data, error } = await supabase
      .from('professional_blocks').insert(row).select('id, office_id, start_time, end_time, motivo').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.delete('/:id/blocks/:blockId', async (req, res) => {
    const { data, error } = await supabase
      .from('professional_blocks').delete()
      .eq('id', req.params.blockId).eq('profile_id', req.params.id)
      .select('id').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Bloqueo no encontrado' });
    res.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 4: Correr el test (debe pasar)**

Run: `cd server && npx vitest run src/api/routes/__tests__/professionals.routes.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Montar en app.ts**

En `server/src/api/app.ts`, agregar el import junto a la línea 17:

```ts
import { professionalsRouter } from './routes/professionals.routes';
```

Y después de la línea del `officeProfessionalsRouter` (Task 3 Step 5):

```ts
app.use('/api/professionals', authContext, requireRole('admin'), professionalsRouter());
```

- [ ] **Step 6: Verificar build y suite completa**

Run: `cd server && npx tsc --noEmit && npx vitest run`
Expected: build sin errores; toda la suite en verde.

- [ ] **Step 7: Commit**

```bash
git add server/src/api/routes/professionals.routes.ts server/src/api/routes/__tests__/professionals.routes.test.ts server/src/api/app.ts
git commit -m "feat(agenda): API profesionales — disponibilidad y bloqueos"
```

---

## Task 5: Tipos y cliente API (frontend)

**Files:**
- Modify: `client/src/types/index.ts`
- Modify: `client/src/lib/api.ts`

- [ ] **Step 1: Agregar tipos**

Al final de `client/src/types/index.ts`, agregar:

```ts
export interface Office {
  id: string;
  account_id: string;
  nombre: string;
  modalidad: 'presencial' | 'video';
  direccion: string | null;
  video_link: string | null;
  dias: number[];
  hora_inicio: string;
  hora_fin: string;
  slot_min: number;
  capacidad: number;
  buffer_min: number;
  activa: boolean;
  orden: number;
}

export interface OfficeProfessional {
  profile_id: string;
  name: string | null;
  role: Role | null;
  activa: boolean;
}

export interface AvailabilityWindow {
  id?: string;
  dia: number;          // 0-6
  hora_inicio: string;  // HH:MM
  hora_fin: string;     // HH:MM
}

export interface ProfessionalBlock {
  id: string;
  office_id: string | null;
  start_time: string;   // ISO
  end_time: string;     // ISO
  motivo: string | null;
}

export interface ProfessionalLite {
  id: string;
  name: string | null;
  role: Role;
}
```

- [ ] **Step 2: Agregar `officesApi` y `professionalsApi`**

En `client/src/lib/api.ts`, antes de la línea `export const apiBase = ...`, agregar (los tipos se importan del módulo de tipos; agregá los nombres al import existente `from '../types'` o agregá un import nuevo):

```ts
import type { Office, OfficeProfessional, AvailabilityWindow, ProfessionalBlock, ProfessionalLite } from '../types';

export const officesApi = {
  list: (accountId: string) =>
    api<Office[]>(`/api/offices?account_id=${encodeURIComponent(accountId)}`),
  create: (body: Partial<Office> & { account_id: string; nombre: string; modalidad: string; hora_inicio: string; hora_fin: string }) =>
    api<Office>('/api/offices', { method: 'POST', body: JSON.stringify(body) }),
  update: (id: string, updates: Partial<Office>) =>
    api<Office>(`/api/offices/${id}`, { method: 'PUT', body: JSON.stringify(updates) }),
  remove: (id: string) =>
    api<{ ok: boolean }>(`/api/offices/${id}`, { method: 'DELETE' }),

  professionals: (officeId: string) =>
    api<OfficeProfessional[]>(`/api/offices/${officeId}/professionals`),
  assign: (officeId: string, profileId: string) =>
    api<OfficeProfessional>(`/api/offices/${officeId}/professionals`, { method: 'POST', body: JSON.stringify({ profile_id: profileId }) }),
  unassign: (officeId: string, profileId: string) =>
    api<{ ok: boolean }>(`/api/offices/${officeId}/professionals/${profileId}`, { method: 'DELETE' }),
};

export const professionalsApi = {
  list: () => api<ProfessionalLite[]>('/api/professionals'),
  getAvailability: (profileId: string, officeId: string) =>
    api<AvailabilityWindow[]>(`/api/professionals/${profileId}/availability?office_id=${encodeURIComponent(officeId)}`),
  setAvailability: (profileId: string, officeId: string, ventanas: AvailabilityWindow[]) =>
    api<AvailabilityWindow[]>(`/api/professionals/${profileId}/availability?office_id=${encodeURIComponent(officeId)}`,
      { method: 'PUT', body: JSON.stringify({ ventanas: ventanas.map(({ dia, hora_inicio, hora_fin }) => ({ dia, hora_inicio, hora_fin })) }) }),
  getBlocks: (profileId: string) =>
    api<ProfessionalBlock[]>(`/api/professionals/${profileId}/blocks`),
  addBlock: (profileId: string, body: { office_id?: string | null; start_time: string; end_time: string; motivo?: string | null }) =>
    api<ProfessionalBlock>(`/api/professionals/${profileId}/blocks`, { method: 'POST', body: JSON.stringify(body) }),
  removeBlock: (profileId: string, blockId: string) =>
    api<{ ok: boolean }>(`/api/professionals/${profileId}/blocks/${blockId}`, { method: 'DELETE' }),
};
```

- [ ] **Step 3: Verificar build**

Run: `cd client && npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add client/src/types/index.ts client/src/lib/api.ts
git commit -m "feat(agenda): tipos y cliente API de oficinas/profesionales"
```

---

## Task 6: Página Oficinas (lista + alta/edición + ruta + nav)

**Files:**
- Create: `client/src/pages/Offices.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/Layout.tsx`

- [ ] **Step 1: Crear la página Offices.tsx**

Crear `client/src/pages/Offices.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { useAccounts } from '../context/AccountContext';
import { officesApi } from '../lib/api';
import type { Office } from '../types';
import { toast } from 'sonner';
import { Building2, Plus, Loader2, Pencil, Trash2 } from 'lucide-react';
import OfficeDetail from '../components/offices/OfficeDetail';

const emptyForm = {
  nombre: '', modalidad: 'presencial' as 'presencial' | 'video', direccion: '', video_link: '',
  hora_inicio: '09:00', hora_fin: '18:00', slot_min: 60, capacidad: 1, buffer_min: 0,
  dias: [1, 2, 3, 4, 5] as number[], activa: true, orden: 0,
};

export default function Offices() {
  const { activeAccountId } = useAccounts();
  const [list, setList] = useState<Office[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState<Office | null>(null);

  const load = useCallback(async () => {
    if (!activeAccountId) { setList([]); setLoading(false); return; }
    setLoading(true);
    try { setList(await officesApi.list(activeAccountId)); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [activeAccountId]);

  useEffect(() => { load(); }, [load]);

  const startEdit = (o: Office) => {
    setEditingId(o.id);
    setForm({
      nombre: o.nombre, modalidad: o.modalidad, direccion: o.direccion ?? '', video_link: o.video_link ?? '',
      hora_inicio: o.hora_inicio, hora_fin: o.hora_fin, slot_min: o.slot_min, capacidad: o.capacidad,
      buffer_min: o.buffer_min, dias: o.dias, activa: o.activa, orden: o.orden,
    });
  };

  const reset = () => { setEditingId(null); setForm(emptyForm); };

  const save = async () => {
    if (!activeAccountId) { toast.error('Elegí una cuenta'); return; }
    if (!form.nombre.trim()) { toast.error('Falta el nombre'); return; }
    if (form.modalidad === 'presencial' && !form.direccion.trim()) { toast.error('Una oficina presencial necesita dirección'); return; }
    if (form.hora_fin <= form.hora_inicio) { toast.error('hora_fin debe ser posterior a hora_inicio'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        direccion: form.direccion.trim() || null,
        video_link: form.video_link.trim() || null,
      };
      if (editingId) await officesApi.update(editingId, payload as any);
      else await officesApi.create({ account_id: activeAccountId, ...payload } as any);
      toast.success(editingId ? 'Oficina actualizada' : 'Oficina creada');
      reset(); load();
    } catch (e: any) { toast.error('Error: ' + e.message); }
    finally { setSaving(false); }
  };

  const remove = async (o: Office) => {
    if (!confirm(`¿Borrar la oficina "${o.nombre}"? Se quitan sus profesionales y horarios.`)) return;
    try { await officesApi.remove(o.id); toast.success('Oficina borrada'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="min-h-screen bg-brand-ivory p-6 lg:p-8 font-sans">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center gap-3 mb-8 border-b border-brand-hairline pb-6">
          <div className="w-11 h-11 rounded-xl bg-brand-primary/[0.07] text-brand-primary flex items-center justify-center">
            <Building2 size={22} />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-brand-ink font-serif">Oficinas</h1>
            <p className="text-sm text-brand-inkmuted">Cargá oficinas, asigná profesionales y configurá sus agendas</p>
          </div>
        </div>

        {!activeAccountId ? (
          <p className="text-sm text-brand-inkmuted">Elegí una cuenta activa en el menú lateral.</p>
        ) : (
          <>
            {/* Formulario alta/edición */}
            <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card p-6 mb-8 relative overflow-hidden">
              <div className="absolute top-0 left-0 right-0 h-1 bg-brand-gold" />
              <h2 className="text-brand-ink font-serif font-bold text-lg mb-4">{editingId ? 'Editar oficina' : 'Nueva oficina'}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input aria-label="Nombre" className="bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm" placeholder="Nombre (ej. CABA)" value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
                <select aria-label="Modalidad" className="bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm" value={form.modalidad} onChange={e => setForm({ ...form, modalidad: e.target.value as any })}>
                  <option value="presencial">Presencial</option>
                  <option value="video">Video</option>
                </select>
                <input aria-label="Dirección" className="bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm" placeholder="Dirección (presencial)" value={form.direccion} onChange={e => setForm({ ...form, direccion: e.target.value })} />
                <input aria-label="Link de video" className="bg-white border border-brand-hairline rounded-xl px-4 py-3 text-brand-ink text-sm" placeholder="Link de video (opcional)" value={form.video_link} onChange={e => setForm({ ...form, video_link: e.target.value })} />
                <div className="flex gap-2">
                  <input aria-label="Hora inicio" type="time" className="bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm flex-1" value={form.hora_inicio} onChange={e => setForm({ ...form, hora_inicio: e.target.value })} />
                  <input aria-label="Hora fin" type="time" className="bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm flex-1" value={form.hora_fin} onChange={e => setForm({ ...form, hora_fin: e.target.value })} />
                </div>
                <div className="flex gap-2">
                  <input aria-label="Duración del turno (min)" type="number" min={1} className="bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm flex-1" placeholder="Slot min" value={form.slot_min} onChange={e => setForm({ ...form, slot_min: Number(e.target.value) })} />
                  <input aria-label="Capacidad" type="number" min={1} className="bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm flex-1" placeholder="Capacidad" value={form.capacidad} onChange={e => setForm({ ...form, capacidad: Number(e.target.value) })} />
                  <input aria-label="Buffer (min)" type="number" min={0} className="bg-white border border-brand-hairline rounded-xl px-3 py-3 text-brand-ink text-sm flex-1" placeholder="Buffer min" value={form.buffer_min} onChange={e => setForm({ ...form, buffer_min: Number(e.target.value) })} />
                </div>
              </div>
              <div className="flex items-center gap-3 mt-4">
                <button onClick={save} disabled={saving} className="flex items-center gap-2 bg-brand-primary text-white px-6 py-3 rounded-xl font-bold text-sm disabled:opacity-40">
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} {editingId ? 'Guardar' : 'Crear'}
                </button>
                {editingId && <button onClick={reset} className="text-sm text-brand-inkmuted px-4 py-3">Cancelar</button>}
              </div>
            </div>

            {/* Lista de oficinas */}
            <div className="bg-brand-surface rounded-2xl border border-brand-hairline shadow-card overflow-hidden">
              {loading ? (
                <div className="p-10 flex justify-center"><Loader2 size={24} className="animate-spin text-brand-primary" /></div>
              ) : list.length === 0 ? (
                <p className="p-10 text-center text-brand-inkmuted text-sm">Sin oficinas todavía.</p>
              ) : list.map(o => (
                <div key={o.id} className="flex items-center justify-between px-5 py-4 border-b border-brand-hairline last:border-0">
                  <button className="text-left" onClick={() => setSelected(o)}>
                    <div className="text-brand-ink text-sm font-semibold">{o.nombre} <span className="text-brand-inkmuted font-normal">· {o.modalidad}</span></div>
                    <div className="text-brand-inkmuted text-xs">{o.direccion || (o.modalidad === 'video' ? 'Videollamada' : '—')}</div>
                  </button>
                  <div className="flex items-center gap-2">
                    <button onClick={() => setSelected(o)} className="text-xs px-3 py-2 rounded-xl border border-brand-hairline text-brand-primary font-semibold">Profesionales</button>
                    <button onClick={() => startEdit(o)} aria-label="Editar" className="p-2 rounded-xl border border-brand-hairline text-brand-inkmuted hover:text-brand-ink"><Pencil size={14} /></button>
                    <button onClick={() => remove(o)} aria-label="Borrar" className="p-2 rounded-xl border border-brand-hairline text-brand-inkmuted hover:text-red-600"><Trash2 size={14} /></button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {selected && <OfficeDetail office={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
```

- [ ] **Step 2: Crear placeholder de OfficeDetail (para que compile)**

Crear `client/src/components/offices/OfficeDetail.tsx` con un stub mínimo (se completa en Tasks 7-9):

```tsx
import type { Office } from '../../types';

export default function OfficeDetail({ office, onClose }: { office: Office; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-brand-surface h-full p-6 overflow-auto" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-serif font-bold text-brand-ink">{office.nombre}</h2>
        <button onClick={onClose} className="mt-4 text-sm text-brand-inkmuted">Cerrar</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Registrar la ruta en App.tsx**

En `client/src/App.tsx`, agregar el lazy import junto a la línea 23:

```tsx
const Offices = lazy(() => import('./pages/Offices'));
```

Y dentro del bloque `<Route element={<RoleRoute role="admin" />}>` (después de la línea 68 `<Route path="/team" element={<Team />} />`):

```tsx
<Route path="/offices" element={<Offices />} />
```

- [ ] **Step 4: Agregar ítem de nav en Layout.tsx**

En `client/src/components/Layout.tsx`, agregar `Building2` al import de `lucide-react` (línea 5). Y en el array `allNav` (después de la línea 13, el ítem de `/team`), agregar:

```tsx
  { to: '/offices', label: 'Oficinas', icon: Building2, roles: ['admin'] },
```

- [ ] **Step 5: Verificar build**

Run: `cd client && npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: build OK.

- [ ] **Step 6: Smoke manual**

Levantar el front (`cd client && npm run dev`), loguear como admin, ir a "Oficinas". Crear una oficina, editarla, borrarla. Verificar toasts y que la lista refresca.

- [ ] **Step 7: Commit**

```bash
git add client/src/pages/Offices.tsx client/src/components/offices/OfficeDetail.tsx client/src/App.tsx client/src/components/Layout.tsx
git commit -m "feat(agenda): UI pagina Oficinas — alta/edicion/borrado"
```

---

## Task 7: OfficeDetail — asignar/quitar profesionales

**Files:**
- Modify: `client/src/components/offices/OfficeDetail.tsx`

- [ ] **Step 1: Implementar la sección de profesionales**

Reemplazar el contenido de `client/src/components/offices/OfficeDetail.tsx` por:

```tsx
import { useEffect, useState, useCallback } from 'react';
import type { Office, OfficeProfessional, ProfessionalLite } from '../../types';
import { officesApi, professionalsApi } from '../../lib/api';
import { toast } from 'sonner';
import { Loader2, UserPlus, X, Clock, CalendarX } from 'lucide-react';
import AvailabilityEditor from './AvailabilityEditor';
import BlocksEditor from './BlocksEditor';

export default function OfficeDetail({ office, onClose }: { office: Office; onClose: () => void }) {
  const [profs, setProfs] = useState<OfficeProfessional[]>([]);
  const [all, setAll] = useState<ProfessionalLite[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState('');
  const [editAvailFor, setEditAvailFor] = useState<OfficeProfessional | null>(null);
  const [editBlocksFor, setEditBlocksFor] = useState<OfficeProfessional | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, a] = await Promise.all([officesApi.professionals(office.id), professionalsApi.list()]);
      setProfs(p); setAll(a);
    } catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [office.id]);

  useEffect(() => { load(); }, [load]);

  const assign = async () => {
    if (!adding) return;
    try { await officesApi.assign(office.id, adding); setAdding(''); toast.success('Profesional asignado'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const unassign = async (p: OfficeProfessional) => {
    try { await officesApi.unassign(office.id, p.profile_id); toast.success('Profesional quitado'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const assignable = all.filter(a => !profs.some(p => p.profile_id === a.id));

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex justify-end" onClick={onClose}>
      <div className="w-full max-w-md bg-brand-surface h-full p-6 overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between mb-1">
          <h2 className="text-lg font-serif font-bold text-brand-ink">{office.nombre}</h2>
          <button onClick={onClose} aria-label="Cerrar" className="text-brand-inkmuted hover:text-brand-ink"><X size={18} /></button>
        </div>
        <p className="text-xs text-brand-inkmuted mb-6">{office.direccion || (office.modalidad === 'video' ? 'Videollamada' : '—')}</p>

        <h3 className="text-sm font-bold text-brand-ink mb-3">Profesionales</h3>

        <div className="flex gap-2 mb-4">
          <select className="flex-1 bg-white border border-brand-hairline rounded-xl px-3 py-2.5 text-sm text-brand-ink" value={adding} onChange={e => setAdding(e.target.value)}>
            <option value="">Elegir profesional…</option>
            {assignable.map(a => <option key={a.id} value={a.id}>{a.name || '(sin nombre)'}</option>)}
          </select>
          <button onClick={assign} disabled={!adding} className="flex items-center gap-1.5 bg-brand-primary text-white px-4 py-2.5 rounded-xl text-sm font-bold disabled:opacity-40">
            <UserPlus size={15} /> Asignar
          </button>
        </div>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-brand-primary" /></div>
        ) : profs.length === 0 ? (
          <p className="text-sm text-brand-inkmuted py-4">Sin profesionales asignados.</p>
        ) : (
          <div className="space-y-2">
            {profs.map(p => (
              <div key={p.profile_id} className="flex items-center justify-between px-4 py-3 rounded-xl border border-brand-hairline">
                <span className="text-sm text-brand-ink font-medium">{p.name || '(sin nombre)'}</span>
                <div className="flex items-center gap-1.5">
                  <button onClick={() => setEditAvailFor(p)} title="Horario" className="p-2 rounded-lg border border-brand-hairline text-brand-inkmuted hover:text-brand-primary"><Clock size={14} /></button>
                  <button onClick={() => setEditBlocksFor(p)} title="Bloqueos" className="p-2 rounded-lg border border-brand-hairline text-brand-inkmuted hover:text-brand-primary"><CalendarX size={14} /></button>
                  <button onClick={() => unassign(p)} title="Quitar" className="p-2 rounded-lg border border-brand-hairline text-brand-inkmuted hover:text-red-600"><X size={14} /></button>
                </div>
              </div>
            ))}
          </div>
        )}

        {editAvailFor && <AvailabilityEditor office={office} prof={editAvailFor} onClose={() => setEditAvailFor(null)} />}
        {editBlocksFor && <BlocksEditor office={office} prof={editBlocksFor} onClose={() => setEditBlocksFor(null)} />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Crear stubs de AvailabilityEditor y BlocksEditor (para compilar)**

Crear `client/src/components/offices/AvailabilityEditor.tsx`:

```tsx
import type { Office, OfficeProfessional } from '../../types';
export default function AvailabilityEditor({ prof, onClose }: { office: Office; prof: OfficeProfessional; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-brand-surface rounded-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <p className="text-brand-ink">Horario de {prof.name}</p>
        <button onClick={onClose} className="mt-4 text-sm text-brand-inkmuted">Cerrar</button>
      </div>
    </div>
  );
}
```

Crear `client/src/components/offices/BlocksEditor.tsx`:

```tsx
import type { Office, OfficeProfessional } from '../../types';
export default function BlocksEditor({ prof, onClose }: { office: Office; prof: OfficeProfessional; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center" onClick={onClose}>
      <div className="bg-brand-surface rounded-2xl p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <p className="text-brand-ink">Bloqueos de {prof.name}</p>
        <button onClick={onClose} className="mt-4 text-sm text-brand-inkmuted">Cerrar</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verificar build**

Run: `cd client && npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores.

- [ ] **Step 4: Smoke manual**

En una oficina, asignar un profesional del dropdown (deben aparecer los empleados activos), verificar que sale de la lista de asignables, y quitarlo.

- [ ] **Step 5: Commit**

```bash
git add client/src/components/offices/
git commit -m "feat(agenda): asignar/quitar profesionales en detalle de oficina"
```

---

## Task 8: AvailabilityEditor — horario semanal del profesional

**Files:**
- Modify: `client/src/components/offices/AvailabilityEditor.tsx`

- [ ] **Step 1: Implementar el editor**

Reemplazar `client/src/components/offices/AvailabilityEditor.tsx` por:

```tsx
import { useEffect, useState, useCallback } from 'react';
import type { Office, OfficeProfessional, AvailabilityWindow } from '../../types';
import { professionalsApi } from '../../lib/api';
import { toast } from 'sonner';
import { Loader2, Plus, X } from 'lucide-react';

const DIAS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']; // index = dia 0-6

export default function AvailabilityEditor({ office, prof, onClose }: { office: Office; prof: OfficeProfessional; onClose: () => void }) {
  const [ventanas, setVentanas] = useState<AvailabilityWindow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setVentanas(await professionalsApi.getAvailability(prof.profile_id, office.id)); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [prof.profile_id, office.id]);

  useEffect(() => { load(); }, [load]);

  const addWindow = (dia: number) =>
    setVentanas(v => [...v, { dia, hora_inicio: office.hora_inicio, hora_fin: office.hora_fin }]);

  const updateWindow = (idx: number, patch: Partial<AvailabilityWindow>) =>
    setVentanas(v => v.map((w, i) => i === idx ? { ...w, ...patch } : w));

  const removeWindow = (idx: number) =>
    setVentanas(v => v.filter((_, i) => i !== idx));

  const save = async () => {
    for (const w of ventanas) {
      if (w.hora_fin <= w.hora_inicio) { toast.error('Cada ventana: hora fin posterior a inicio'); return; }
    }
    setSaving(true);
    try {
      await professionalsApi.setAvailability(prof.profile_id, office.id, ventanas);
      toast.success('Horario guardado'); onClose();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-brand-surface rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-base font-serif font-bold text-brand-ink">Horario de {prof.name}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-brand-inkmuted hover:text-brand-ink"><X size={18} /></button>
        </div>
        <p className="text-xs text-brand-inkmuted mb-4">En {office.nombre}. Varias ventanas por día (ej. mañana y tarde).</p>

        {loading ? (
          <div className="py-8 flex justify-center"><Loader2 size={20} className="animate-spin text-brand-primary" /></div>
        ) : (
          <div className="space-y-4">
            {DIAS.map((label, dia) => {
              const wins = ventanas.map((w, i) => ({ w, i })).filter(({ w }) => w.dia === dia);
              return (
                <div key={dia} className="border border-brand-hairline rounded-xl p-3">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold text-brand-ink">{label}</span>
                    <button onClick={() => addWindow(dia)} className="flex items-center gap-1 text-xs text-brand-primary font-semibold"><Plus size={13} /> Ventana</button>
                  </div>
                  {wins.length === 0 ? (
                    <p className="text-xs text-brand-inkmuted">No atiende</p>
                  ) : wins.map(({ w, i }) => (
                    <div key={i} className="flex items-center gap-2 mb-1.5">
                      <input type="time" className="bg-white border border-brand-hairline rounded-lg px-2 py-1.5 text-sm" value={w.hora_inicio} onChange={e => updateWindow(i, { hora_inicio: e.target.value })} />
                      <span className="text-brand-inkmuted text-xs">a</span>
                      <input type="time" className="bg-white border border-brand-hairline rounded-lg px-2 py-1.5 text-sm" value={w.hora_fin} onChange={e => updateWindow(i, { hora_fin: e.target.value })} />
                      <button onClick={() => removeWindow(i)} aria-label="Quitar ventana" className="text-brand-inkmuted hover:text-red-600 ml-1"><X size={14} /></button>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-3 mt-6">
          <button onClick={save} disabled={saving || loading} className="flex items-center gap-2 bg-brand-primary text-white px-6 py-2.5 rounded-xl font-bold text-sm disabled:opacity-40">
            {saving ? <Loader2 size={15} className="animate-spin" /> : null} Guardar
          </button>
          <button onClick={onClose} className="text-sm text-brand-inkmuted">Cancelar</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar build**

Run: `cd client && npx tsc --noEmit -p tsconfig.app.json`
Expected: sin errores.

- [ ] **Step 3: Smoke manual**

Abrir "Horario" de un profesional, agregar ventanas en Lun/Mié, guardar, reabrir y verificar que persisten. Probar guardar con hora fin < inicio (debe rechazar con toast).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/offices/AvailabilityEditor.tsx
git commit -m "feat(agenda): editor de horario semanal por profesional"
```

---

## Task 9: BlocksEditor — bloqueos puntuales del profesional

**Files:**
- Modify: `client/src/components/offices/BlocksEditor.tsx`

- [ ] **Step 1: Implementar el editor de bloqueos**

Reemplazar `client/src/components/offices/BlocksEditor.tsx` por:

```tsx
import { useEffect, useState, useCallback } from 'react';
import type { Office, OfficeProfessional, ProfessionalBlock } from '../../types';
import { professionalsApi } from '../../lib/api';
import { toast } from 'sonner';
import { Loader2, Plus, X, Trash2 } from 'lucide-react';

// datetime-local (YYYY-MM-DDTHH:MM) -> ISO con offset del navegador.
function toISO(local: string): string { return new Date(local).toISOString(); }
function fmt(iso: string): string { return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }); }

export default function BlocksEditor({ office, prof, onClose }: { office: Office; prof: OfficeProfessional; onClose: () => void }) {
  const [blocks, setBlocks] = useState<ProfessionalBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const [motivo, setMotivo] = useState('');
  const [soloEsta, setSoloEsta] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setBlocks(await professionalsApi.getBlocks(prof.profile_id)); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, [prof.profile_id]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    if (!start || !end) { toast.error('Completá inicio y fin'); return; }
    if (toISO(end) <= toISO(start)) { toast.error('El fin debe ser posterior al inicio'); return; }
    setSaving(true);
    try {
      await professionalsApi.addBlock(prof.profile_id, {
        office_id: soloEsta ? office.id : null,
        start_time: toISO(start), end_time: toISO(end), motivo: motivo.trim() || null,
      });
      toast.success('Bloqueo agregado'); setStart(''); setEnd(''); setMotivo(''); load();
    } catch (e: any) { toast.error(e.message); }
    finally { setSaving(false); }
  };

  const remove = async (b: ProfessionalBlock) => {
    try { await professionalsApi.removeBlock(prof.profile_id, b.id); toast.success('Bloqueo borrado'); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="fixed inset-0 z-[60] bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-brand-surface rounded-2xl p-6 w-full max-w-lg max-h-[85vh] overflow-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-serif font-bold text-brand-ink">Bloqueos de {prof.name}</h3>
          <button onClick={onClose} aria-label="Cerrar" className="text-brand-inkmuted hover:text-brand-ink"><X size={18} /></button>
        </div>

        <div className="border border-brand-hairline rounded-xl p-3 mb-4 space-y-2">
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-brand-inkmuted">Desde<input type="datetime-local" className="mt-1 w-full bg-white border border-brand-hairline rounded-lg px-2 py-1.5 text-sm" value={start} onChange={e => setStart(e.target.value)} /></label>
            <label className="flex-1 text-xs text-brand-inkmuted">Hasta<input type="datetime-local" className="mt-1 w-full bg-white border border-brand-hairline rounded-lg px-2 py-1.5 text-sm" value={end} onChange={e => setEnd(e.target.value)} /></label>
          </div>
          <input className="w-full bg-white border border-brand-hairline rounded-lg px-3 py-2 text-sm" placeholder="Motivo (opcional)" value={motivo} onChange={e => setMotivo(e.target.value)} />
          <label className="flex items-center gap-2 text-xs text-brand-inkmuted">
            <input type="checkbox" checked={soloEsta} onChange={e => setSoloEsta(e.target.checked)} />
            Solo en {office.nombre} (destildá para todas las oficinas)
          </label>
          <button onClick={add} disabled={saving} className="flex items-center gap-1.5 bg-brand-primary text-white px-4 py-2 rounded-xl text-sm font-bold disabled:opacity-40">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Agregar bloqueo
          </button>
        </div>

        {loading ? (
          <div className="py-6 flex justify-center"><Loader2 size={20} className="animate-spin text-brand-primary" /></div>
        ) : blocks.length === 0 ? (
          <p className="text-sm text-brand-inkmuted">Sin bloqueos.</p>
        ) : (
          <div className="space-y-2">
            {blocks.map(b => (
              <div key={b.id} className="flex items-center justify-between px-3 py-2.5 rounded-xl border border-brand-hairline">
                <div>
                  <div className="text-sm text-brand-ink">{fmt(b.start_time)} → {fmt(b.end_time)}</div>
                  <div className="text-xs text-brand-inkmuted">{b.motivo || 'Sin motivo'}{b.office_id ? '' : ' · todas las oficinas'}</div>
                </div>
                <button onClick={() => remove(b)} aria-label="Borrar" className="p-2 text-brand-inkmuted hover:text-red-600"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verificar build**

Run: `cd client && npx tsc --noEmit -p tsconfig.app.json && npm run build`
Expected: build OK.

- [ ] **Step 3: Smoke manual**

Abrir "Bloqueos" de un profesional, agregar un bloqueo (con y sin "solo en esta oficina"), verificar que aparece y se puede borrar. Probar fin < inicio (rechaza).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/offices/BlocksEditor.tsx
git commit -m "feat(agenda): editor de bloqueos por profesional"
```

---

## Task 10: Verificación end-to-end y cierre

- [ ] **Step 1: Suite backend completa**

Run: `cd server && npx vitest run && npx tsc --noEmit`
Expected: todo verde, sin errores de tipos.

- [ ] **Step 2: Build frontend**

Run: `cd client && npm run build`
Expected: build OK.

- [ ] **Step 3: Auditoría de migraciones**

Run: `cd server && node scripts/db-audit.js`
Expected: `OK 0018_office_professionals`, `OK 0019_professional_availability`, `OK 0020_professional_blocks` (requiere haber aplicado Task 1 Step 4 en Supabase).

- [ ] **Step 4: Flujo manual completo**

Como admin: crear oficina → asignar 2 profesionales → cargar horario distinto a cada uno → cargar un bloqueo → borrar uno → borrar la oficina y confirmar que no quedan errores. Confirmar que el agente IA/flows sigue funcionando igual (Fase 1 NO cambia el agendado).

- [ ] **Step 5: Actualizar memoria**

Actualizar `agente-y-agenda-features.md` y `MEMORY.md`: Fase 1 de agendas por oficina (profesionales + disponibilidad + bloqueos) implementada; Fase 2 (motor de capacidad + vistas de agenda) pendiente.

---

## Notas de implementación

- **Frontend sin runner de tests**: `client/package.json` no tiene script `test`. La verificación de cada task de UI es `tsc --noEmit` + `npm run build` + smoke manual. No inventar un runner en Fase 1.
- **Reuse vs duplicación**: el dropdown de profesionales usa `GET /api/professionals` (profiles activos, incluye admin), NO `/api/team` (que solo lista empleadas). Esto cumple "profesional = profile" del spec.
- **`capacidad` sigue activa**: cargar disponibilidad NO cambia todavía lo que ofrece el agente. El motor real se reescribe en Fase 2. Comunicar para no generar expectativa.
- **Borrado de oficina**: físico, con `ON DELETE CASCADE` → arrastra asignaciones/disponibilidad/bloqueos. Las citas (`appointments.oficina` texto) conservan el nombre histórico.
```

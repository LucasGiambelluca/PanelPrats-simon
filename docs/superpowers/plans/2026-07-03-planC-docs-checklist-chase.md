# Plan C — Checklist de documentación + chase Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Registrar la documentación pedida a cada cliente como checklist por documento (pedido/entregado) y que el agente persiga por WhatsApp (template) los docs pendientes hasta que los entreguen o se alcance un máximo.

**Architecture:** Tabla `appointment_docs` (ítems por cita) + service CRUD + rutas API + UI en la ficha de la cita. El `AppointmentFollowupScheduler` (Plan B) se extiende: el seguimiento post-reunión manda `docs_pendientes` si hay docs pendientes, y una función pura `docChaseDue` decide los recordatorios de docs siguientes (cadencia + máximo). Recepción marca "entregado" a mano.

**Tech Stack:** TypeScript, Express, Supabase/Postgres, React, WhatsApp Cloud API templates, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-recordatorios-seguimiento-docs-design.md`
**Depende de:** Plan A (templates) y Plan B (scheduler + flags `doc_chase_count`/`doc_chase_last_at` ya migrados en 0037).

---

## File Structure

- **Create** `supabase/migrations/0036_appointment_docs.sql` — tabla de ítems de documentación.
- **Create** `server/src/services/AppointmentDocsService.ts` — CRUD + query de pendientes por cita.
- **Create** `server/src/services/__tests__/appointmentDocs.chase.test.ts` — tests de la lógica pura `docChaseDue`.
- **Modify** `server/src/services/appointmentFollowupLogic.ts` — `docChaseDue` (pura).
- **Create** `server/src/api/routes/appointmentDocs.routes.ts` — rutas REST.
- **Modify** `server/src/api/app.ts` — montar el router.
- **Modify** `server/src/services/AppointmentFollowupScheduler.ts` — integrar docs en el seguimiento + evento chase.
- **Modify** `client/src/lib/api.ts` — `docsApi` + tipos.
- **Create** `client/src/components/DocsChecklist.tsx` — UI del checklist.
- **Modify** (host de la ficha de cita en `client/`) — render del checklist.

---

### Task 1: Migración 0036 (`appointment_docs`)

**Files:**
- Create: `supabase/migrations/0036_appointment_docs.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0036: checklist de documentación por cita. Cada fila es un documento con estado
-- pedido/entregado. Reemplaza (sin borrar) el texto libre appointments.faltante.
CREATE TABLE IF NOT EXISTS appointment_docs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  account_id     text NOT NULL,
  documento      text NOT NULL,
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','entregado')),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointment_docs_appt ON appointment_docs(appointment_id);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0036_appointment_docs.sql
git commit -m "feat(docs): migración 0036 tabla appointment_docs"
```

---

### Task 2: `AppointmentDocsService`

**Files:**
- Create: `server/src/services/AppointmentDocsService.ts`

- [ ] **Step 1: Implementar el service**

Crear `server/src/services/AppointmentDocsService.ts`:

```typescript
import { supabase } from '../config/supabase';

export interface AppointmentDoc {
  id: string;
  appointment_id: string;
  account_id: string;
  documento: string;
  estado: 'pendiente' | 'entregado';
  requested_at: string;
  delivered_at: string | null;
  created_at: string;
}

export const AppointmentDocsService = {
  async list(appointmentId: string): Promise<AppointmentDoc[]> {
    const { data, error } = await supabase
      .from('appointment_docs').select('*')
      .eq('appointment_id', appointmentId)
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return (data ?? []) as AppointmentDoc[];
  },

  async add(appointmentId: string, accountId: string, documento: string): Promise<AppointmentDoc> {
    const { data, error } = await supabase
      .from('appointment_docs')
      .insert({ appointment_id: appointmentId, account_id: accountId, documento })
      .select('*').single();
    if (error) throw new Error(error.message);
    return data as AppointmentDoc;
  },

  async setEstado(id: string, estado: 'pendiente' | 'entregado'): Promise<void> {
    const patch = estado === 'entregado'
      ? { estado, delivered_at: new Date().toISOString() }
      : { estado, delivered_at: null };
    const { error } = await supabase.from('appointment_docs').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  },

  async remove(id: string): Promise<void> {
    const { error } = await supabase.from('appointment_docs').delete().eq('id', id);
    if (error) throw new Error(error.message);
  },

  /** Mapa appointment_id → lista de nombres de docs PENDIENTES, para las citas dadas. */
  async pendingByAppointmentIds(ids: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (ids.length === 0) return out;
    const { data, error } = await supabase
      .from('appointment_docs').select('appointment_id, documento')
      .in('appointment_id', ids).eq('estado', 'pendiente');
    if (error) throw new Error(error.message);
    for (const r of data ?? []) {
      const arr = out.get((r as any).appointment_id) ?? [];
      arr.push((r as any).documento);
      out.set((r as any).appointment_id, arr);
    }
    return out;
  },
};
```

- [ ] **Step 2: Verificar compila**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/AppointmentDocsService.ts
git commit -m "feat(docs): AppointmentDocsService (CRUD + pendientes por cita)"
```

---

### Task 3: Lógica pura `docChaseDue`

**Files:**
- Modify: `server/src/services/appointmentFollowupLogic.ts`
- Test: `server/src/services/__tests__/appointmentDocs.chase.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `server/src/services/__tests__/appointmentDocs.chase.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { docChaseDue } from '../appointmentFollowupLogic';

const CFG = { docChaseEnabled: true, everyDays: 3, max: 3 };
const D = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-07-20T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('docChaseDue', () => {
  it('con docs pendientes, follow-up ya hecho, pasó la cadencia → dispara', () => {
    const a = { status: 'asistio', followup_sent: true, doc_chase_count: 1, doc_chase_last_at: iso(now - 4 * D) };
    expect(docChaseDue(a, 2, now, CFG)).toBe(true);
  });
  it('sin docs pendientes → no dispara', () => {
    const a = { status: 'asistio', followup_sent: true, doc_chase_count: 1, doc_chase_last_at: iso(now - 4 * D) };
    expect(docChaseDue(a, 0, now, CFG)).toBe(false);
  });
  it('cadencia no cumplida (último chase hace 1 día) → no dispara', () => {
    const a = { status: 'asistio', followup_sent: true, doc_chase_count: 1, doc_chase_last_at: iso(now - 1 * D) };
    expect(docChaseDue(a, 2, now, CFG)).toBe(false);
  });
  it('alcanzó el máximo → no dispara', () => {
    const a = { status: 'asistio', followup_sent: true, doc_chase_count: 3, doc_chase_last_at: iso(now - 10 * D) };
    expect(docChaseDue(a, 2, now, CFG)).toBe(false);
  });
  it('follow-up todavía no hecho → no dispara (el chase empieza después del follow-up)', () => {
    const a = { status: 'asistio', followup_sent: false, doc_chase_count: 0, doc_chase_last_at: null };
    expect(docChaseDue(a, 2, now, CFG)).toBe(false);
  });
  it('docs agregados después del follow-up (sin last_at) → dispara', () => {
    const a = { status: 'asistio', followup_sent: true, doc_chase_count: 0, doc_chase_last_at: null };
    expect(docChaseDue(a, 1, now, CFG)).toBe(true);
  });
  it('cancelada → no dispara', () => {
    const a = { status: 'cancelada', followup_sent: true, doc_chase_count: 1, doc_chase_last_at: iso(now - 10 * D) };
    expect(docChaseDue(a, 2, now, CFG)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd server && npx vitest run src/services/__tests__/appointmentDocs.chase.test.ts`
Expected: FAIL — `docChaseDue` no exportada.

- [ ] **Step 3: Implementar `docChaseDue`**

Agregar a `server/src/services/appointmentFollowupLogic.ts` (al final):

```typescript
export interface DocChaseCfg {
  docChaseEnabled: boolean;
  everyDays: number;
  max: number;
}
export interface ChaseAppt {
  status: string;
  followup_sent?: boolean;
  doc_chase_count?: number;
  doc_chase_last_at?: string | null;
}

/**
 * ¿Toca mandar un recordatorio de documentación pendiente?
 * El chase arranca DESPUÉS del follow-up (que ya mandó el primer pedido de docs),
 * respeta la cadencia (everyDays desde el último chase) y un máximo de intentos.
 */
export function docChaseDue(a: ChaseAppt, pendingCount: number, now: number, cfg: DocChaseCfg): boolean {
  if (!cfg.docChaseEnabled) return false;
  if (a.status === 'cancelada') return false;
  if (!a.followup_sent) return false;
  if (pendingCount <= 0) return false;
  if ((a.doc_chase_count ?? 0) >= cfg.max) return false;
  const lastMs = a.doc_chase_last_at ? new Date(a.doc_chase_last_at).getTime() : 0;
  return (now - lastMs) >= cfg.everyDays * 24 * 60 * 60 * 1000;
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd server && npx vitest run src/services/__tests__/appointmentDocs.chase.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/appointmentFollowupLogic.ts server/src/services/__tests__/appointmentDocs.chase.test.ts
git commit -m "feat(docs): lógica pura docChaseDue"
```

---

### Task 4: Rutas REST de docs

**Files:**
- Create: `server/src/api/routes/appointmentDocs.routes.ts`
- Modify: `server/src/api/app.ts`

- [ ] **Step 1: Leer el patrón de un router existente**

Leé `server/src/api/routes/pendientes.routes.ts` (o `appointments.routes.ts`) para copiar el estilo (`Router()`, `authContext` ya aplicado al montar, try/catch → 400).

- [ ] **Step 2: Implementar el router**

Crear `server/src/api/routes/appointmentDocs.routes.ts`:

```typescript
import { Router } from 'express';
import { AppointmentDocsService } from '../../services/AppointmentDocsService';

export function appointmentDocsRouter(): Router {
  const r = Router();

  // Lista los docs de una cita.
  r.get('/:appointmentId', async (req, res) => {
    try {
      res.json({ docs: await AppointmentDocsService.list(req.params.appointmentId) });
    } catch (e: any) { res.status(400).json({ error: e?.message ?? 'error' }); }
  });

  // Agrega un doc al checklist.
  r.post('/:appointmentId', async (req, res) => {
    try {
      const { account_id, documento } = req.body ?? {};
      if (!account_id || !documento) return res.status(400).json({ error: 'account_id y documento son obligatorios' });
      res.json({ doc: await AppointmentDocsService.add(req.params.appointmentId, account_id, String(documento).trim()) });
    } catch (e: any) { res.status(400).json({ error: e?.message ?? 'error' }); }
  });

  // Marca un doc entregado/pendiente.
  r.patch('/item/:id', async (req, res) => {
    try {
      const estado = req.body?.estado;
      if (estado !== 'pendiente' && estado !== 'entregado') return res.status(400).json({ error: 'estado inválido' });
      await AppointmentDocsService.setEstado(req.params.id, estado);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e?.message ?? 'error' }); }
  });

  // Borra un doc del checklist.
  r.delete('/item/:id', async (req, res) => {
    try {
      await AppointmentDocsService.remove(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e?.message ?? 'error' }); }
  });

  return r;
}
```

- [ ] **Step 3: Montar el router**

En `server/src/api/app.ts`, junto a los otros `app.use('/api/...', authContext, ...Router())` (ver el de pendientes en `app.ts:87`), agregar:
```typescript
import { appointmentDocsRouter } from './routes/appointmentDocs.routes';
// …
app.use('/api/appointment-docs', authContext, appointmentDocsRouter());
```
(Ubicar el import junto a los otros imports de routers y el `app.use` junto a los otros montajes con `authContext`.)

- [ ] **Step 4: Verificar compila**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/routes/appointmentDocs.routes.ts server/src/api/app.ts
git commit -m "feat(docs): rutas REST de appointment_docs"
```

---

### Task 5: Integrar docs en el scheduler (follow-up + chase)

**Files:**
- Modify: `server/src/services/AppointmentFollowupScheduler.ts`

- [ ] **Step 1: Extender el scheduler**

En `AppointmentFollowupScheduler.ts`:

Agregar imports:
```typescript
import { AppointmentDocsService } from './AppointmentDocsService';
import { dueAppointmentEvents, docChaseDue, fechaAR, horaAR, type SchedulerCfg, type DocChaseCfg } from './appointmentFollowupLogic';
```
(Reemplazar el import previo de `appointmentFollowupLogic` por este, que suma `docChaseDue` y `DocChaseCfg`.)

Agregar config de chase como propiedad de la clase (junto a `CFG`):
```typescript
  private readonly DOC_CFG: DocChaseCfg = { docChaseEnabled: true, everyDays: 3, max: 3 };
```

Reemplazar el cuerpo de `tick()` para (a) traer los docs pendientes de la ventana, (b) usar `docs_pendientes` en el follow-up cuando corresponda, (c) agregar el evento de chase:

```typescript
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const nowIso = new Date(now).toISOString();
      const appts = await AppointmentService.listFollowupWindow(this.PAST_MS, this.FUTURE_MS);
      const pendingByAppt = await AppointmentDocsService.pendingByAppointmentIds(appts.map((a) => a.id));

      for (const a of appts) {
        if (!this.isConnected(a.account_id)) continue;
        const nombre = a.nombre?.trim() || 'Hola';
        const pending = pendingByAppt.get(a.id) ?? [];
        const events = dueAppointmentEvents(a as any, now, this.CFG);

        for (const ev of events) {
          try {
            if (ev === 'reminder_24h' && a.start_time) {
              const sede = a.oficina?.trim() || 'el estudio';
              const t = buildTemplate('reminder_24h', [nombre, fechaAR(a.start_time), horaAR(a.start_time), sede]);
              await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
              await AppointmentService.setSchedulerFlags(a.id, { reminder_24h_sent: true });
            } else if (ev === 'followup' && a.start_time) {
              if (a.status === 'no_asistio') {
                const t = buildTemplate('reagendar', [nombre, fechaAR(a.start_time)]);
                await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
                await AppointmentService.setSchedulerFlags(a.id, { followup_sent: true });
              } else if (pending.length > 0) {
                // Follow-up + primer pedido de docs en un solo mensaje.
                const t = buildTemplate('docs_pendientes', [nombre, pending.join(', ')]);
                await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
                await AppointmentService.setSchedulerFlags(a.id, { followup_sent: true, doc_chase_count: 1, doc_chase_last_at: nowIso });
              } else {
                const t = buildTemplate('seguimiento', [nombre]);
                await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
                await AppointmentService.setSchedulerFlags(a.id, { followup_sent: true });
              }
            }
          } catch (err: any) {
            console.error(`[FollowupScheduler] error evento ${ev} cita ${a.id}:`, err?.message ?? err);
          }
        }

        // Chase de documentación (recordatorios siguientes al primer pedido).
        if (docChaseDue(a as any, pending.length, now, this.DOC_CFG)) {
          try {
            const t = buildTemplate('docs_pendientes', [nombre, pending.join(', ')]);
            await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
            await AppointmentService.setSchedulerFlags(a.id, {
              doc_chase_count: (a.doc_chase_count ?? 0) + 1,
              doc_chase_last_at: nowIso,
            });
            console.log(`[FollowupScheduler] doc_chase → ${a.phone} (cita ${a.id})`);
          } catch (err: any) {
            console.error(`[FollowupScheduler] error doc_chase cita ${a.id}:`, err?.message ?? err);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
```

- [ ] **Step 2: Verificar compila + tests verdes**

Run: `cd server && npx tsc --noEmit && npx vitest run src/services/__tests__/appointmentFollowupLogic.test.ts src/services/__tests__/appointmentDocs.chase.test.ts`
Expected: sin errores; tests verdes.

- [ ] **Step 3: Commit**

```bash
git add server/src/services/AppointmentFollowupScheduler.ts
git commit -m "feat(docs): scheduler manda docs_pendientes en follow-up + chase"
```

---

### Task 6: Cliente API + UI del checklist

**Files:**
- Modify: `client/src/lib/api.ts`
- Create: `client/src/components/DocsChecklist.tsx`
- Modify: host de la ficha de cita (localizar, ver Step 3)

- [ ] **Step 1: Agregar `docsApi` + tipos en `client/src/lib/api.ts`**

```typescript
// ── Documentación de la cita ────────────────────────────────
export interface AppointmentDoc {
  id: string;
  appointment_id: string;
  account_id: string;
  documento: string;
  estado: 'pendiente' | 'entregado';
  requested_at: string;
  delivered_at: string | null;
  created_at: string;
}
export const docsApi = {
  list: (appointmentId: string) =>
    api<{ docs: AppointmentDoc[] }>(`/api/appointment-docs/${appointmentId}`),
  add: (appointmentId: string, accountId: string, documento: string) =>
    api<{ doc: AppointmentDoc }>(`/api/appointment-docs/${appointmentId}`, {
      method: 'POST', body: JSON.stringify({ account_id: accountId, documento }),
    }),
  setEstado: (id: string, estado: 'pendiente' | 'entregado') =>
    api<{ ok: boolean }>(`/api/appointment-docs/item/${id}`, {
      method: 'PATCH', body: JSON.stringify({ estado }),
    }),
  remove: (id: string) =>
    api<{ ok: boolean }>(`/api/appointment-docs/item/${id}`, { method: 'DELETE' }),
};
```

- [ ] **Step 2: Crear el componente `DocsChecklist.tsx`**

Crear `client/src/components/DocsChecklist.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { docsApi, type AppointmentDoc } from '../lib/api';

export function DocsChecklist({ appointmentId, accountId }: { appointmentId: string; accountId: string }) {
  const [docs, setDocs] = useState<AppointmentDoc[]>([]);
  const [nuevo, setNuevo] = useState('');
  const [loading, setLoading] = useState(true);

  const recargar = () => docsApi.list(appointmentId).then((r) => setDocs(r.docs)).finally(() => setLoading(false));
  useEffect(() => { recargar(); /* eslint-disable-next-line */ }, [appointmentId]);

  const pendientes = docs.filter((d) => d.estado === 'pendiente').length;

  const agregar = async () => {
    const doc = nuevo.trim();
    if (!doc) return;
    setNuevo('');
    await docsApi.add(appointmentId, accountId, doc).catch(() => {});
    recargar();
  };
  const toggle = async (d: AppointmentDoc) => {
    await docsApi.setEstado(d.id, d.estado === 'pendiente' ? 'entregado' : 'pendiente').catch(() => {});
    recargar();
  };
  const borrar = async (d: AppointmentDoc) => {
    await docsApi.remove(d.id).catch(() => {});
    recargar();
  };

  return (
    <div className="mt-3">
      <div className="flex items-center gap-2 mb-2">
        <h4 className="font-semibold text-sm text-brand-ink">Documentación</h4>
        {pendientes > 0 && <span className="text-xs bg-amber-100 text-amber-800 rounded px-2 py-0.5">{pendientes} pendiente{pendientes > 1 ? 's' : ''}</span>}
      </div>
      {loading ? <p className="text-xs text-brand-inkmuted">Cargando…</p> : (
        <ul className="space-y-1">
          {docs.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={d.estado === 'entregado'} onChange={() => toggle(d)} />
              <span className={d.estado === 'entregado' ? 'line-through text-brand-inkmuted' : ''}>{d.documento}</span>
              <button onClick={() => borrar(d)} className="ml-auto text-xs text-red-500 hover:underline">quitar</button>
            </li>
          ))}
          {!docs.length && <li className="text-xs text-brand-inkmuted">Sin documentos cargados.</li>}
        </ul>
      )}
      <div className="flex gap-2 mt-2">
        <input
          value={nuevo} onChange={(e) => setNuevo(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') agregar(); }}
          placeholder="Agregar documento (ej: DNI)"
          className="border rounded px-2 py-1 text-sm flex-1"
        />
        <button onClick={agregar} className="px-3 py-1 rounded bg-brand-gold text-brand-ink text-sm font-semibold">Agregar</button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Renderizar el checklist en la ficha de la cita**

Localizar el componente que muestra el detalle/ficha de una cita en el cliente:
Run: `cd client && grep -rlE "appointment|cita" src/pages src/components | head` y buscar el panel/modal de detalle de cita (probablemente en la Agenda). Leerlo para encontrar dónde tiene el objeto `appointment` con `id` y `account_id`.

En ese componente, donde se muestran los campos de la cita, agregar:
```tsx
import { DocsChecklist } from '../components/DocsChecklist';
// … dentro del render del detalle, con el appointment disponible:
<DocsChecklist appointmentId={appointment.id} accountId={appointment.account_id} />
```
(Ajustar el path del import y los nombres `appointment.id`/`appointment.account_id` a como estén en ese componente.)

- [ ] **Step 4: Verificar compila + build**

Run: `cd client && npx tsc --noEmit && npm run build`
Expected: build OK, sin errores de tipo.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api.ts client/src/components/DocsChecklist.tsx client/src/pages client/src/components
git commit -m "feat(docs): checklist de documentación en la ficha de la cita"
```

---

## Verificación (post-Plan C)

1. Aplicar migración 0036 en Supabase (SQL Editor).
2. `cd server && npx vitest run` → suite completa verde.
3. En el panel: abrir una cita, agregar 2 docs, marcar uno entregado → persiste al recargar; badge muestra 1 pendiente.
4. Con el template `documentacion_pendiente` aprobado: una cita `asistio` con docs pendientes recibe, a T+24h, el mensaje con la lista de docs; a los 3 días (si sigue pendiente) recibe el recordatorio, hasta 3 veces.

## Notas

- El chase arranca DESPUÉS del follow-up: el follow-up post-reunión ya manda `docs_pendientes` como primer pedido (setea `doc_chase_count=1`), y `docChaseDue` maneja los recordatorios siguientes. Si recepción agrega docs DESPUÉS del follow-up, `docChaseDue` los persigue igual (last_at nulo → dispara).
- Detección de entrega por media entrante: fuera de alcance. Recepción marca entregado a mano.

# Plan B — Scheduler proactivo: reminder 24hs + post-reunión Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar por template el recordatorio 24hs antes de la cita y el seguimiento post-reunión a las 24hs (según asistió / no asistió), con lógica de disparo pura y testeable.

**Architecture:** Una función pura `dueAppointmentEvents(appt, now, cfg)` decide qué eventos temporales están vencidos (idempotencia por flags). Un scheduler nuevo `AppointmentFollowupScheduler` (tick 60s, mismo patrón que `ReminderScheduler`) hace el I/O: trae la ventana de citas, llama la función pura, y por cada evento manda el template correspondiente y persiste el flag. Convive con `ReminderScheduler` (que sigue con el recordatorio corto del día + no_asistio).

**Tech Stack:** TypeScript, Express, Supabase/Postgres, WhatsApp Cloud API, Vitest.

**Spec:** `docs/superpowers/specs/2026-07-03-recordatorios-seguimiento-docs-design.md`
**Depende de:** Plan A (capa de templates) ya implementado — usa `buildTemplate`, `AccountManager.sendTemplate`.

---

## File Structure

- **Create** `supabase/migrations/0037_appointment_followup_flags.sql` — flags de idempotencia en `appointments`.
- **Modify** `server/src/services/AppointmentService.ts` — campos nuevos en `Appointment`; `setSchedulerFlags`; `listFollowupWindow`.
- **Create** `server/src/services/appointmentFollowupLogic.ts` — función pura `dueAppointmentEvents` + helpers de formato.
- **Create** `server/src/services/__tests__/appointmentFollowupLogic.test.ts` — tests de la función pura.
- **Create** `server/src/services/AppointmentFollowupScheduler.ts` — scheduler I/O.
- **Modify** `server/src/index.ts` — instanciar/arrancar/parar el scheduler.

---

### Task 1: Migración 0037 (flags)

**Files:**
- Create: `supabase/migrations/0037_appointment_followup_flags.sql`

- [ ] **Step 1: Escribir la migración**

```sql
-- 0037: flags de idempotencia para el scheduler de proactivos (reminder 24h,
-- seguimiento post-reunión, chase de documentación). Idempotente.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminder_24h_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup_sent     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doc_chase_count   int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doc_chase_last_at timestamptz;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/0037_appointment_followup_flags.sql
git commit -m "feat(agente): migración 0037 flags de scheduler de proactivos"
```

> Aplicar en Supabase se hace en el paso de verificación final (no acá). La prod no tiene conexión Postgres directa → SQL Editor.

---

### Task 2: Campos + acceso a datos en `AppointmentService`

**Files:**
- Modify: `server/src/services/AppointmentService.ts`

- [ ] **Step 1: Agregar los campos a la interfaz `Appointment`**

En `AppointmentService.ts`, en `export interface Appointment` (después de `reminded?: boolean;`, línea ~16), agregar:

```typescript
  reminder_24h_sent?: boolean; // recordatorio 24h antes ya enviado
  followup_sent?: boolean;     // seguimiento post-reunión ya enviado
  doc_chase_count?: number;    // cuántos recordatorios de docs se mandaron
  doc_chase_last_at?: string | null; // timestamp del último chase de docs
```
(Los campos `doc_chase_*` los usa el Plan C; se declaran acá para no volver a tocar la interfaz.)

`deserializeAppointmentCore` ya hace `...app`, así que estas columnas raw pasan solas al leer. No hay que tocar el deserializador.

- [ ] **Step 2: Agregar `setSchedulerFlags` (escritura directa de los flags)**

En la clase `AppointmentService`, agregar un método que actualiza SOLO las columnas de flags sin pasar por el `update()` grande (que mergea toda la ficha):

```typescript
  async setSchedulerFlags(
    id: string,
    patch: Partial<{ reminder_24h_sent: boolean; followup_sent: boolean; doc_chase_count: number; doc_chase_last_at: string }>,
  ): Promise<void> {
    if (!isSupabaseConfigured) {
      const cur = memoryAppointments.get(id);
      if (cur) memoryAppointments.set(id, { ...cur, ...patch } as any);
      return;
    }
    const { error } = await supabase.from('appointments').update(patch).eq('id', id);
    if (error) throw new Error(error.message);
  }
```
(`isSupabaseConfigured`, `memoryAppointments`, `supabase` ya están importados/definidos en el archivo — verificá los nombres exactos en el módulo y usalos.)

- [ ] **Step 3: Agregar `listFollowupWindow` (ventana que INCLUYE estados terminales)**

`listSchedulerWindow` excluye `asistio`/`no_asistio` — pero el post-reunión los NECESITA. Agregar un método aparte:

```typescript
  /**
   * Citas para el scheduler de proactivos: ventana [now-pastMs, now+futureMs] por
   * start_time, excluyendo SOLO 'cancelada'. A diferencia de listSchedulerWindow,
   * INCLUYE asistio/no_asistio/cerrado (el seguimiento post-reunión los usa).
   */
  async listFollowupWindow(pastMs: number, futureMs: number): Promise<Appointment[]> {
    const now = Date.now();
    const fromIso = new Date(now - pastMs).toISOString();
    const toIso = new Date(now + futureMs).toISOString();
    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('appointments')
        .select('*')
        .gte('start_time', fromIso)
        .lte('start_time', toIso)
        .neq('status', 'cancelada');
      if (error) throw new Error(error.message);
      return (data || []).map(deserializeAppointment);
    }
    return Array.from(memoryAppointments.values()).filter((a) => {
      if (!a.start_time || a.status === 'cancelada') return false;
      const t = new Date(a.start_time).getTime();
      return t >= now - pastMs && t <= now + futureMs;
    });
  }
```
(`deserializeAppointment` ya existe en el módulo — reusarlo.)

- [ ] **Step 4: Verificar que compila**

Run: `cd server && npx tsc --noEmit`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/AppointmentService.ts
git commit -m "feat(agente): campos de scheduler + setSchedulerFlags + listFollowupWindow"
```

---

### Task 3: Lógica pura `dueAppointmentEvents`

**Files:**
- Create: `server/src/services/appointmentFollowupLogic.ts`
- Test: `server/src/services/__tests__/appointmentFollowupLogic.test.ts`

- [ ] **Step 1: Escribir los tests que fallan**

Crear `server/src/services/__tests__/appointmentFollowupLogic.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { dueAppointmentEvents, fechaAR, horaAR } from '../appointmentFollowupLogic';

const CFG = { reminder24hEnabled: true, followupEnabled: true };
const H = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('dueAppointmentEvents', () => {
  const now = Date.parse('2026-07-08T12:00:00.000Z');

  it('reminder_24h: cita en <24h, no enviado → dispara', () => {
    const a = { status: 'confirmada', start_time: iso(now + 20 * H), reminder_24h_sent: false, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).toContain('reminder_24h');
  });
  it('reminder_24h: cita a >24h → NO dispara', () => {
    const a = { status: 'confirmada', start_time: iso(now + 30 * H), reminder_24h_sent: false, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).not.toContain('reminder_24h');
  });
  it('reminder_24h: ya enviado → NO dispara', () => {
    const a = { status: 'confirmada', start_time: iso(now + 5 * H), reminder_24h_sent: true, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).not.toContain('reminder_24h');
  });
  it('followup: 24h después del turno, no enviado → dispara', () => {
    const a = { status: 'asistio', start_time: iso(now - 25 * H), reminder_24h_sent: true, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).toContain('followup');
  });
  it('followup: solo 10h después → NO dispara todavía', () => {
    const a = { status: 'asistio', start_time: iso(now - 10 * H), reminder_24h_sent: true, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).not.toContain('followup');
  });
  it('cancelada → ningún evento', () => {
    const a = { status: 'cancelada', start_time: iso(now - 25 * H), reminder_24h_sent: false, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).toEqual([]);
  });
  it('flags apagados → nada aunque corresponda', () => {
    const a = { status: 'asistio', start_time: iso(now - 25 * H), reminder_24h_sent: false, followup_sent: false };
    expect(dueAppointmentEvents(a, now, { reminder24hEnabled: false, followupEnabled: false })).toEqual([]);
  });
});

describe('formato AR', () => {
  it('horaAR devuelve HH:mm en zona AR', () => {
    // 2026-07-08T18:30:00Z = 15:30 AR (UTC-3)
    expect(horaAR('2026-07-08T18:30:00.000Z')).toBe('15:30');
  });
  it('fechaAR devuelve día/mes', () => {
    expect(fechaAR('2026-07-08T18:30:00.000Z')).toMatch(/8\/7/);
  });
});
```

- [ ] **Step 2: Correr los tests para verificar que fallan**

Run: `cd server && npx vitest run src/services/__tests__/appointmentFollowupLogic.test.ts`
Expected: FAIL — módulo inexistente.

- [ ] **Step 3: Implementar la lógica pura**

Crear `server/src/services/appointmentFollowupLogic.ts`:

```typescript
// Lógica PURA del scheduler de proactivos: decide qué eventos temporales están
// vencidos para una cita. Sin DB, sin red, sin reloj (now se pasa por parámetro).
export type FollowupEvent = 'reminder_24h' | 'followup';

export interface SchedulerAppt {
  status: string;
  start_time?: string | null;
  reminder_24h_sent?: boolean;
  followup_sent?: boolean;
}
export interface SchedulerCfg {
  reminder24hEnabled: boolean;
  followupEnabled: boolean;
}

const H24 = 24 * 60 * 60 * 1000;

export function dueAppointmentEvents(a: SchedulerAppt, now: number, cfg: SchedulerCfg): FollowupEvent[] {
  const out: FollowupEvent[] = [];
  if (a.status === 'cancelada' || !a.start_time) return out;
  const startMs = new Date(a.start_time).getTime();
  if (!Number.isFinite(startMs)) return out;

  const msUntil = startMs - now;
  // Recordatorio 24h antes: dispara una vez cuando faltan ≤24h y la cita no empezó.
  if (cfg.reminder24hEnabled && !a.reminder_24h_sent && msUntil > 0 && msUntil <= H24) {
    out.push('reminder_24h');
  }
  // Seguimiento: dispara una vez cuando pasaron ≥24h del inicio del turno.
  if (cfg.followupEnabled && !a.followup_sent && (now - startMs) >= H24) {
    out.push('followup');
  }
  return out;
}

const AR_TZ = 'America/Argentina/Buenos_Aires';

/** Hora HH:mm (24h) del ISO en zona Argentina. */
export function horaAR(iso: string): string {
  return new Date(iso).toLocaleTimeString('es-AR', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: AR_TZ,
  });
}

/** Fecha "díaSemana d/m" del ISO en zona Argentina (ej "miércoles 8/7"). */
export function fechaAR(iso: string): string {
  const d = new Date(iso);
  const dia = d.toLocaleDateString('es-AR', { weekday: 'long', timeZone: AR_TZ });
  const dm = d.toLocaleDateString('es-AR', { day: 'numeric', month: 'numeric', timeZone: AR_TZ });
  return `${dia} ${dm}`;
}
```

- [ ] **Step 4: Correr los tests para verificar que pasan**

Run: `cd server && npx vitest run src/services/__tests__/appointmentFollowupLogic.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/services/appointmentFollowupLogic.ts server/src/services/__tests__/appointmentFollowupLogic.test.ts
git commit -m "feat(agente): lógica pura dueAppointmentEvents + formato AR"
```

---

### Task 4: `AppointmentFollowupScheduler` + wiring

**Files:**
- Create: `server/src/services/AppointmentFollowupScheduler.ts`
- Modify: `server/src/index.ts`

- [ ] **Step 1: Leer el patrón**

Leé `server/src/services/ReminderScheduler.ts` completo — copiá el esqueleto (`timer`, `running`, `start`/`stop`, `isConnected`, guardas de solapamiento). El nuevo scheduler es análogo pero manda templates.

- [ ] **Step 2: Implementar el scheduler**

Crear `server/src/services/AppointmentFollowupScheduler.ts`:

```typescript
import type { AccountManager } from '../core/accounts/AccountManager';
import { AppointmentService } from './AppointmentService';
import { buildTemplate } from './whatsappTemplates';
import { dueAppointmentEvents, fechaAR, horaAR, type SchedulerCfg } from './appointmentFollowupLogic';

/**
 * AppointmentFollowupScheduler — mensajes proactivos por template (fuera de la
 * ventana de 24h de WhatsApp): recordatorio 24h antes y seguimiento post-reunión.
 * Convive con ReminderScheduler (recordatorio corto del día + no_asistio).
 */
export class AppointmentFollowupScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private readonly TICK_MS = 60 * 1000;
  private readonly PAST_MS = 3 * 24 * 60 * 60 * 1000;   // hasta 3 días después del turno
  private readonly FUTURE_MS = 2 * 24 * 60 * 60 * 1000; // hasta 2 días antes del turno
  private readonly CFG: SchedulerCfg = { reminder24hEnabled: true, followupEnabled: true };

  constructor(private manager: AccountManager) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error('[FollowupScheduler] tick error:', e?.message ?? e));
    }, this.TICK_MS);
    console.log('📨 [AppointmentFollowupScheduler] activo (reminder 24h + post-reunión por template)');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private isConnected(accountId: string): boolean {
    const s = this.manager.getStatus(accountId);
    return s === 'WORKING' || s === 'connected';
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const appts = await AppointmentService.listFollowupWindow(this.PAST_MS, this.FUTURE_MS);
      for (const a of appts) {
        const events = dueAppointmentEvents(a as any, now, this.CFG);
        if (!events.length) continue;
        if (!this.isConnected(a.account_id)) continue; // reintenta el próximo tick

        const nombre = a.nombre?.trim() || 'Hola';
        for (const ev of events) {
          try {
            if (ev === 'reminder_24h' && a.start_time) {
              const sede = a.oficina?.trim() || 'el estudio';
              const t = buildTemplate('reminder_24h', [nombre, fechaAR(a.start_time), horaAR(a.start_time), sede]);
              await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
              await AppointmentService.setSchedulerFlags(a.id, { reminder_24h_sent: true });
              console.log(`[FollowupScheduler] reminder_24h → ${a.phone} (cita ${a.id})`);
            } else if (ev === 'followup' && a.start_time) {
              // no_asistio → reagendar; resto → seguimiento. (Plan C: si hay docs
              // pendientes, se manda docs_pendientes en vez de seguimiento.)
              const t = a.status === 'no_asistio'
                ? buildTemplate('reagendar', [nombre, fechaAR(a.start_time)])
                : buildTemplate('seguimiento', [nombre]);
              await this.manager.sendTemplate(a.account_id, a.phone, t.name, t.lang, t.components, t.preview);
              await AppointmentService.setSchedulerFlags(a.id, { followup_sent: true });
              console.log(`[FollowupScheduler] followup(${a.status}) → ${a.phone} (cita ${a.id})`);
            }
          } catch (err: any) {
            // No marcamos el flag: reintenta el próximo tick.
            console.error(`[FollowupScheduler] error evento ${ev} cita ${a.id}:`, err?.message ?? err);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}
```

- [ ] **Step 3: Cablear en `index.ts`**

En `server/src/index.ts`:

Agregar el import arriba (junto a los otros scheduler imports):
```typescript
import { AppointmentFollowupScheduler } from './services/AppointmentFollowupScheduler';
```
Instanciar junto a los otros (después de `const reengage = createNightReengageScheduler(manager);`, línea ~63):
```typescript
  // Proactivos por template: recordatorio 24h antes + seguimiento post-reunión.
  const followups = new AppointmentFollowupScheduler(manager);
```
Parar en el shutdown (después de `reengage.stop();`, línea ~80):
```typescript
      followups.stop();
```
Arrancar (después de `reengage.start();`, línea ~100):
```typescript
  followups.start();
```

- [ ] **Step 4: Verificar compila + tests verdes**

Run: `cd server && npx tsc --noEmit && npx vitest run src/services/__tests__/appointmentFollowupLogic.test.ts`
Expected: sin errores; tests verdes.

- [ ] **Step 5: Commit**

```bash
git add server/src/services/AppointmentFollowupScheduler.ts server/src/index.ts
git commit -m "feat(agente): AppointmentFollowupScheduler (reminder 24h + post-reunión) cableado"
```

---

## Verificación (post-Plan A + B)

1. Aplicar migración 0037 en Supabase (SQL Editor).
2. `cd server && npx vitest run` → suite completa verde.
3. Con al menos el template `recordatorio_cita_24h` aprobado en Meta: crear una cita de prueba a <24h y confirmar que el recordatorio llega por WhatsApp aunque el contacto no haya escrito en las últimas 24h.

## Notas

- La ventana `PAST_MS=3d` evita spamear citas viejas en el primer arranque (solo procesa las de los últimos 3 días).
- El post-reunión de Plan B manda `seguimiento` a todos los no-`no_asistio`. El Plan C reemplaza esa rama por: si la cita tiene docs pendientes → `docs_pendientes`; si no → `seguimiento`.

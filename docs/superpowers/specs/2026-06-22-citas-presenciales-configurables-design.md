# Spec — Citas presenciales configurables (agenda por oficina)

**Fecha:** 2026-06-22
**Rama base:** `feat-omnichannel`
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Relacionado:** se apoya en el agente IA-primero (`docs/superpowers/specs/2026-06-22-agente-ia-first-design.md`).

---

## 1. Objetivo

Hoy las citas presenciales no son configurables y el agente las maneja mal:
- El path de **flujos** (`AppointmentProposalsExecutor`) calcula slots reales, pero la config (días, horario, duración) vive **en cada nodo** (`nodeData`), no a nivel cuenta. `oficina` es solo un string: sin dirección, sin horario propio, capacidad fija 1.
- El path del **agente** (`check_availability` tool) es flojo: devuelve los turnos **ocupados** y deja que el modelo improvise los libres. Sin oficinas, sin dirección, sin grilla real.
- No existe un registro de oficinas del estudio (CABA/Quilmes/Haedo/Video) con sus direcciones, horarios y capacidad.

Se construye una **config de agenda a nivel cuenta** (`account_offices`) que **un único servicio** (`AvailabilityService`) usa para los dos caminos (agente + flujos): slots libres reales respetando capacidad por oficina, y la dirección/link al confirmar.

### Decisiones tomadas (brainstorming)
| Tema | Decisión |
|---|---|
| Fuente de disponibilidad | **Panel-native** (tabla `appointments`); sin Google Calendar |
| Granularidad | **Oficina + capacidad** (cupos en paralelo; ej. Video=2, CABA=1). No se modela cada abogada |
| Alcance v1 | **Backend + API de config** (CRUD admin). Sin pantalla en el panel todavía |
| Enfoque técnico | Tabla `account_offices` + `AvailabilityService` único (se extrae la lógica de slots del executor) |

### No-objetivos (YAGNI)
- No integración con Google Calendar (puede venir después; el modelo no lo impide).
- No modelado de abogadas/profesionales ni prioridad de asignación (la capacidad cubre los turnos paralelos).
- No pantalla de config en el panel (la API queda lista para consumirla luego).
- No feriados por cuenta en v1 (igual que hoy; se puede sumar después).

---

## 2. Modelo de datos: `account_offices`

Una fila por oficina/modalidad de la cuenta. Migración `0016_account_offices.sql` (idempotente, no toca `appointments`).

```sql
CREATE TABLE IF NOT EXISTS account_offices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL,
  nombre       text NOT NULL,                 -- "CABA", "Quilmes", "Videollamada"
  modalidad    text NOT NULL DEFAULT 'presencial',  -- 'presencial' | 'video'
  direccion    text,                          -- solo presencial; el bot la dice al confirmar
  video_link   text,                          -- solo video (opcional)
  dias         int[] NOT NULL DEFAULT '{1,2,3,4,5}', -- 0=dom … 6=sáb
  hora_inicio  text NOT NULL DEFAULT '09:00',
  hora_fin     text NOT NULL DEFAULT '18:00',
  slot_min     int  NOT NULL DEFAULT 60,
  capacidad    int  NOT NULL DEFAULT 1,        -- cupos en paralelo
  buffer_min   int  NOT NULL DEFAULT 0,        -- antelación mínima desde "ahora"
  activa       boolean NOT NULL DEFAULT true,
  orden        int  NOT NULL DEFAULT 0,        -- orden de oferta al cliente
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_offices_account ON account_offices(account_id);
ALTER TABLE account_offices ENABLE ROW LEVEL SECURITY;
```

**Relación con `appointments`:** la cita sigue guardando `oficina` (texto). El match es por **nombre normalizado** (`lower(appointments.oficina) == lower(account_offices.nombre)`). No se migra histórico; oficina no configurada → defaults (capacidad 1).

**Por qué tabla y no jsonb:** consultable, CRUD por fila para API/UI, capacidad e índices naturales.

---

## 3. `AvailabilityService` (lógica única de disponibilidad)

Se extrae el cálculo de slots (hoy embebido en `AppointmentProposalsExecutor`) a un servicio reutilizable que lee `account_offices` y respeta capacidad. Solo calcula disponibilidad; no envía mensajes ni crea citas.

```ts
interface Office {
  id: string; account_id: string; nombre: string; modalidad: 'presencial' | 'video';
  direccion?: string | null; video_link?: string | null; dias: number[];
  hora_inicio: string; hora_fin: string; slot_min: number; capacidad: number;
  buffer_min: number; activa: boolean; orden: number;
}
interface Slot { start: string; end: string; } // ISO

class AvailabilityService {
  listOffices(accountId: string): Promise<Office[]>;            // solo activas, ordenadas por `orden`
  getOffice(accountId: string, nombre: string): Promise<Office | null>; // match por nombre normalizado
  freeSlots(accountId: string, nombreOficina: string, opts?: { desde?: string; hasta?: string; max?: number }): Promise<Slot[]>;
  hasCapacity(accountId: string, nombreOficina: string, start: string, end: string): Promise<boolean>;
}
```

**`freeSlots`** (reusa la lógica probada del executor, generalizada):
1. Carga la oficina (días, hora_inicio/fin, slot_min, capacidad, buffer_min). Si no existe → `[]`.
2. Genera slots candidatos: por cada día permitido en la ventana (default próximos ~14 días hábiles), grilla de `slot_min` entre hora_inicio y hora_fin, respetando `buffer_min` desde ahora.
3. Cuenta citas activas solapadas de **esa oficina** (`appointments` no canceladas, `oficina == nombre`).
4. Slot **libre si `solapadas < capacidad`** (cambio clave vs hoy, que era `== 0`).
5. Devuelve hasta `max` (default 3).

**`hasCapacity`** = conteo puntual para `(start,end)`: `solapadas < capacidad`. Recheck pre-reserva (UX).

**Zona horaria:** America/Argentina/Buenos_Aires explícita (igual que `ReminderScheduler`).

**Refactor de `AppointmentProposalsExecutor`:** delega en `AvailabilityService.freeSlots` cuando hay oficina configurada; si no, cae a los defaults del nodo (`nodeData.startHour/slotDuration/...`) → compat hacia atrás, no rompe flujos existentes. El formateo del mensaje queda en el executor.

---

## 4. Tools del agente

Identidad server-side (accountId/phone del ctx) en todas. Cambian 2, se agrega 1.

| Tool | Cambio | Contrato |
|---|---|---|
| `list_offices` | **nueva** | `{}` → `AvailabilityService.listOffices(ctx.accountId)` → `[{nombre, modalidad, direccion}]` (activas, ordenadas) |
| `check_availability` | **reescrita** | `{ oficina, desde?, hasta? }` → `freeSlots(...)` → `{ oficina, slots:[{start,end}] }` o `{ oficina, slots:[], sin_oficina:true }` si la oficina no existe |
| `book_appointment` | **ajustada** | `{ nombre, oficina, start_time, end_time, resumen }` → `hasCapacity` (no → `{ok:false,error}`) → `AppointmentService.create` → `{ ok, appointment_id, modalidad, direccion?\|video_link? }` |
| `reschedule_appointment` | **ajustada** | mantiene guard anti-IDOR (ownership account_id+phone) **+** `hasCapacity` del nuevo horario en la oficina de la cita |
| `cancel_appointment` | sin cambios | guard anti-IDOR ya implementado |
| `search_knowledge` / `handoff_to_human` | sin cambios | — |

Al confirmar una reserva, el agente **dice la dirección** (presencial) o **manda el link** (video) — sale del resultado de la tool, no lo inventa el modelo. Si `oficina` no matchea → el agente vuelve a `list_offices` (no improvisa horarios).

**Schemas (function-calling):** se agrega `list_offices`; `check_availability` aclara "devuelve horarios LIBRES; usá list_offices primero"; `oficina` pasa a requerido en `check_availability`/`book_appointment`.

**Persona (reglas de agendado):** 1) `list_offices` → 2) preguntar modalidad/oficina → 3) `check_availability` → 4) ofrecer slots → 5) confirmar datos → 6) `book_appointment` → 7) dar dirección/link.

---

## 5. API de config de oficinas

CRUD de `account_offices` en `/api/offices`, **admin-gated** + `validateBody` (zod, ya existe). Nuevo archivo `server/src/api/routes/offices.routes.ts`, montado en `app.ts` junto a los otros admin. Cubierto por el `apiLimiter` general.

```
GET    /api/offices?account_id=…   → lista
POST   /api/offices                → crea
PUT    /api/offices/:id            → edita (404 si no existe)
DELETE /api/offices/:id            → borra (o soft: activa=false)
```
Guard: `authContext` + `requireRole('admin')` (como flows/config/team). Modelo single-org → sin scoping cross-tenant extra (consistente con la auditoría).

**`createOfficeSchema` (zod `.strict()`):**
```ts
{
  account_id: z.string().min(1),
  nombre: z.string().trim().min(1),
  modalidad: z.enum(['presencial','video']),
  direccion: z.string().nullish(),
  video_link: z.string().url().nullish(),
  dias: z.array(z.number().int().min(0).max(6)).default([1,2,3,4,5]),
  hora_inicio: z.string().regex(/^\d{2}:\d{2}$/),
  hora_fin: z.string().regex(/^\d{2}:\d{2}$/),
  slot_min: z.number().int().positive().default(60),
  capacidad: z.number().int().positive().default(1),
  buffer_min: z.number().int().min(0).default(0),
  activa: z.boolean().default(true),
  orden: z.number().int().default(0),
}
```
`updateOfficeSchema` = `.partial().strict()`.

**Coherencia en el handler (además de zod):** presencial sin `direccion` → 400; `hora_fin <= hora_inicio` → 400.

**Panel UI:** fuera de v1; la API queda lista para consumirse después.

---

## 6. Constraint + concurrencia con capacidad

`0012` tiene un `EXCLUDE` que prohíbe cualquier solape en `(cuenta, oficina)` = capacidad fija 1. Con capacidad >1 bloquea reservas paralelas válidas. Se generaliza sin perder la protección anti-carrera.

**Migración `0017_office_capacity.sql`** — reemplaza el EXCLUDE por un trigger capacity-aware con lock:
```
1. ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;
2. CREATE OR REPLACE FUNCTION check_office_capacity() RETURNS trigger:
     - si NEW.status='cancelada' o NEW.start_time/end_time NULL → RETURN NEW;
     - PERFORM pg_advisory_xact_lock(hashtext(NEW.account_id::text || '|' || lower(coalesce(NEW.oficina,''))));
         -- serializa las reservas de ESA oficina (cierra la carrera)
     - cap := COALESCE((SELECT capacidad FROM account_offices
                        WHERE account_id=NEW.account_id
                          AND lower(nombre)=lower(coalesce(NEW.oficina,'')) AND activa), 1);
         -- oficina no configurada → 1 (comportamiento viejo)
     - ocupadas := count citas no canceladas, misma cuenta+oficina,
                   con tstzrange(start_time,end_time) && tstzrange(NEW.start_time,NEW.end_time),
                   id <> NEW.id;
     - IF ocupadas >= cap THEN RAISE EXCEPTION 'office_capacity_full' USING ERRCODE='check_violation'; END IF;
     - RETURN NEW;
3. CREATE TRIGGER trg_office_capacity BEFORE INSERT OR UPDATE ON appointments
     FOR EACH ROW EXECUTE FUNCTION check_office_capacity();
```

**Por qué el advisory lock:** sin él, dos inserts concurrentes podrían contar `ocupadas < cap` a la vez y ambos pasar (overbooking). `pg_advisory_xact_lock` por `(cuenta, oficina)` serializa las reservas de esa oficina dentro de la transacción → race-safe, como el EXCLUDE lo era para capacidad 1.

**Compat hacia atrás:** oficina no configurada → capacidad 1 → mismo comportamiento que hoy. Flows/citas existentes no se rompen. Requiere `btree_gist`/rangos ya presentes (0012 ya creó la extensión).

**`AppointmentService`:** mantiene el manejo de `SLOT_TAKEN`; agrega mapear el error del trigger (`office_capacity_full`) → `throw new Error('SLOT_TAKEN')`. La capa de arriba (tool `book_appointment`, executor) lo maneja sin cambios.

**Doble defensa (como el resto del proyecto):**
- UX (app): `AvailabilityService.hasCapacity` pre-chequea → ofrece otro horario amablemente.
- Garantía (DB): trigger + advisory lock = verdad final, race-safe.

---

## 7. Testing

**Unit (vitest, mock supabase/servicios):**
- `AvailabilityService.freeSlots`: grilla correcta (días/horario/slot_min) + `buffer_min`; **capacidad 2 con 1 cita → libre; con 2 → ocupado** (test clave); oficina inexistente → vacío; TZ AR (slot 11:00 AR no se corre por UTC).
- `AvailabilityService.hasCapacity`: `ocupadas < capacidad` en el borde.
- `ToolRegistry`: `list_offices` (solo activas, ordenadas); `check_availability` (delega + identidad ctx); `book_appointment` (sin cupo → ok:false; éxito → devuelve direccion/video_link); `reschedule` (guard anti-IDOR + capacidad del nuevo horario).
- `offices.routes`: `validateBody` rechaza modalidad inválida / presencial sin dirección / hora_fin ≤ hora_inicio; PUT/DELETE 404 si no existe.
- `AppointmentProposalsExecutor` (refactor): delega si hay oficina configurada; cae a defaults del nodo si no (ambos caminos).

**Integración/DB (donde se pueda):** trigger de capacidad — capacidad 1 rechaza el 2º solapado; capacidad 2 acepta 2 y rechaza el 3º. Si no hay PG de test local, queda como smoke manual documentado (la lógica app-level se cubre en unit).

**Smoke del agente:** conversación de agendado presencial end-to-end (list_offices → check_availability → book → dirección), con una key de modelo con saldo.

**Regresión:** suite completa verde; el trigger nuevo no debe romper `AppointmentAvailabilityExecutor` ni `AppointmentProposalsExecutor`.

---

## 8. Orden de implementación sugerido (para el plan)
1. Migración `0016` (`account_offices`) + tipos `Office`/`Slot`.
2. `AvailabilityService` (`listOffices`/`getOffice`/`freeSlots`/`hasCapacity`) + tests (incl. capacidad y TZ).
3. Migración `0017` (trigger de capacidad + advisory lock) + mapeo del error en `AppointmentService` → `SLOT_TAKEN`.
4. Tools del agente: `list_offices` nueva, `check_availability`/`book_appointment`/`reschedule` ajustadas + persona + tests.
5. Refactor `AppointmentProposalsExecutor` para delegar en `AvailabilityService` (con fallback a defaults) + tests.
6. `offices.routes` (CRUD admin + zod) montado en `app.ts` + tests.
7. Verificación: suite completa + smoke de agendado presencial.

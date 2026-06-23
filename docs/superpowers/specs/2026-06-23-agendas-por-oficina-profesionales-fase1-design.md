# Agendas por oficina con profesionales — Fase 1: Configuración

Fecha: 2026-06-23
Rama: `feat-omnichannel`
Estado: aprobado (diseño), pendiente de plan de implementación.

## Contexto

Hoy el agendado funciona contra `account_offices` (migración 0016): cada oficina es un
pool con un `capacidad` fijo. `AvailabilityService` calcula slots y un trigger
(`check_office_capacity`, 0017) evita overbooking. No existe el concepto de
**profesional** que atiende en una oficina ni agenda por persona.

El estudio quiere:
- Cargar/editar oficinas desde una UI (hoy solo hay API `/api/offices`, sin pantalla).
- Asignar **profesionales** (que son empleados del panel) a cada oficina.
- Configurar la **disponibilidad** de cada profesional por oficina (horario base) y
  cargar **bloqueos** puntuales (vacaciones, "ocupado de 15 a 17").

Esta es la **Fase 1**: modelo de datos + API + UI de configuración. NO cambia todavía
cómo reserva el agente/flows (eso es Fase 2).

### Decisiones del modelo (cerradas en brainstorming)

1. **Profesional = empleado** = fila de `profiles` (rol `empleada` o `admin`). No se crea
   una entidad nueva de persona; se reutiliza el equipo existente.
2. **Reserva = pool de oficina** (el cliente reserva en la oficina, no elige persona).
   En Fase 2 la capacidad pasará a derivarse de los profesionales disponibles.
3. **Disponibilidad por (profesional + oficina)**: un profesional puede atender en varias
   oficinas con horarios distintos.
4. **Asignación de un turno a un profesional concreto = manual** (Fase 2).
5. **Bloqueos puntuales**: sí, por profesional, opcionalmente acotados a una oficina.

## Objetivos (Fase 1)

- Pantalla admin `Oficinas`: listar, crear, editar, eliminar oficinas (CRUD sobre la API
  existente, hoy sin UI).
- Asignar/quitar profesionales a una oficina.
- Editar el horario base semanal de un profesional en una oficina.
- Cargar/listar/borrar bloqueos puntuales de un profesional.

## No objetivos (explícitamente Fase 2)

- Recálculo de capacidad desde profesionales disponibles.
- Reescritura del trigger `check_office_capacity`.
- Cambios en las tools del agente IA / flows.
- Vistas de calendario (agenda general de oficina / agenda personal).
- Asignación de turnos existentes a un profesional.
- `appointments.assigned_profile_id` (se agrega en Fase 2).

## Modelo de datos

Tres tablas nuevas. Convención de día = **0-6** (0=domingo … 6=sábado), igual que
`account_offices.dias` y `Date.getDay()`. Todas idempotentes y con RLS habilitada (igual
que el resto del esquema; el backend usa service key).

### 0018_office_professionals.sql

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

### 0019_professional_availability.sql

```sql
-- 0019: horario base semanal de un profesional en una oficina. Idempotente.
-- Varias filas por (profile_id, office_id, dia) = varias ventanas (ej. 09-12 y 15-18).
CREATE TABLE IF NOT EXISTS professional_availability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  office_id    uuid NOT NULL REFERENCES account_offices(id) ON DELETE CASCADE,
  dia          smallint NOT NULL CHECK (dia BETWEEN 0 AND 6),
  hora_inicio  text NOT NULL,   -- 'HH:MM'
  hora_fin     text NOT NULL,   -- 'HH:MM'
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_avail_office  ON professional_availability(office_id);
CREATE INDEX IF NOT EXISTS idx_prof_avail_profile ON professional_availability(profile_id);
ALTER TABLE professional_availability ENABLE ROW LEVEL SECURITY;
```

### 0020_professional_blocks.sql

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

`profiles` y `account_offices` quedan sin cambios en Fase 1.

## API

Todo bajo `authContext + requireRole('admin')`, igual que `/api/offices` hoy
(`app.ts:71`). Stack: Express + Zod (`validateBody`) + `supabase` service client, mismo
patrón que `offices.routes.ts`.

### Oficinas (ya existe — sin cambios)

```
GET    /api/offices?account_id=<uuid>
POST   /api/offices
PUT    /api/offices/:id
DELETE /api/offices/:id
```

Nota de mejora menor incluida en Fase 1: hoy `DELETE /api/offices/:id` es borrado físico.
Con `ON DELETE CASCADE` en las tablas nuevas, borrar una oficina arrastra sus asignaciones,
disponibilidad y bloqueos. Las citas (`appointments.oficina` es texto) NO se tocan: quedan
con el nombre histórico. Se documenta; no se cambia el comportamiento de borrado en Fase 1.

### Profesionales de una oficina — `office_professionals.routes.ts`

```
GET    /api/offices/:id/professionals
  -> filas de office_professionals join profiles: [{ profile_id, name, activa }]

POST   /api/offices/:id/professionals      body: { profile_id }
  -> upsert (PK office_id+profile_id); activa=true. 200 con la fila.

DELETE /api/offices/:id/professionals/:profileId
  -> borra la asignación. 200 { ok: true }. 404 si no existía.
```

### Disponibilidad y bloqueos — `professionals.routes.ts`

```
GET  /api/professionals
  -> empleados asignables. Reusa la fuente de /api/team: profiles activos
     (id, name, role). (No se crea tabla nueva; el profesional ES un profile.)

GET  /api/professionals/:id/availability?office_id=<uuid>
  -> ventanas de ese profesional en esa oficina: [{ id, dia, hora_inicio, hora_fin }]

PUT  /api/professionals/:id/availability?office_id=<uuid>
  body: { ventanas: [{ dia, hora_inicio, hora_fin }, ...] }
  -> REEMPLAZA todo el set de (profile_id, office_id): borra las filas previas e inserta
     las nuevas en una operación. Simplifica el editor (manda el estado completo).

GET    /api/professionals/:id/blocks
  -> [{ id, office_id, start_time, end_time, motivo }] ordenados por start_time

POST   /api/professionals/:id/blocks
  body: { office_id?: uuid|null, start_time, end_time, motivo? }

DELETE /api/professionals/:id/blocks/:blockId
```

Wiring en `app.ts` (junto a la línea 71):

```ts
app.use('/api/offices', authContext, requireRole('admin'), officesRouter());
app.use('/api/offices', authContext, requireRole('admin'), officeProfessionalsRouter());
app.use('/api/professionals', authContext, requireRole('admin'), professionalsRouter());
```

(El router de profesionales-de-oficina monta sub-rutas `/:id/professionals` bajo
`/api/offices`; alternativamente se fusiona dentro de `officesRouter()`. Decisión de
implementación, no de diseño.)

### Validación (Zod)

- `assignSchema`: `{ profile_id: string.uuid }`.
- `ventanaSchema`: `{ dia: int 0-6, hora_inicio: /^\d{2}:\d{2}$/, hora_fin: /^\d{2}:\d{2}$/ }`
  con regla `hora_fin > hora_inicio` (comparación string HH:MM, igual que `offices.routes.ts:25`).
- `availabilityPutSchema`: `{ ventanas: ventanaSchema[] }` (puede ser `[]` = sin horario).
- `blockSchema`: `{ office_id: string.uuid.nullish(), start_time: datetime, end_time: datetime, motivo: string.nullish() }`
  con `end_time > start_time`.

Las ventanas NO se validan contra los horarios de la oficina en Fase 1 (el motor de Fase 2
intersecta igual). Se documenta como decisión.

## Frontend

Stack: React + Vite + TypeScript + Tailwind (paleta `brand-*`) + react-router + `sonner`
(toast) + `lucide-react`. Patrón de página admin: `client/src/pages/Team.tsx`.

### Ruta y navegación

- Nueva página `client/src/pages/Offices.tsx`, lazy-loaded en `App.tsx`, dentro del bloque
  `RoleRoute role="admin"`: `<Route path="/offices" element={<Offices />} />`.
- Agregar ítem "Oficinas" al nav de `client/src/components/Layout.tsx` (solo admin).

### Selección de cuenta

Las oficinas pertenecen a una cuenta (`account_id`). La página necesita un `account_id`.
Reusar el mismo selector de cuenta que ya usan otras páginas admin (ej. cómo `Accounts`/
`BotBuilder` eligen cuenta). Decisión de implementación: confirmar el mecanismo existente
en el plan. Por defecto: selector de cuenta arriba de la lista de oficinas.

### Estructura de UI

```
┌─ Oficinas ───────────────────────────────┐
│ [Cuenta ▾]                 [+ Nueva]      │
│ ┌─────────┐ ┌─────────┐ ┌─────────┐       │
│ │ CABA    │ │ Quilmes │ │ Video   │       │
│ │ presenc.│ │ presenc.│ │ video   │       │
│ │ 3 profs │ │ 2 profs │ │ 1 prof  │       │
│ └─────────┘ └─────────┘ └─────────┘       │
└───────────────────────────────────────────┘
  click oficina -> panel detalle (modal o panel lateral):
┌─ CABA · Av. 1 ────────────────────────────┐
│ [Editar datos] modalidad/dirección/slot…  │
│ ── Profesionales ──        [+ Asignar ▾]  │
│ • Dra. López   [Horario] [Bloqueos] [Quitar]
│ • Dr. Pérez    [Horario] [Bloqueos] [Quitar]
└───────────────────────────────────────────┘
  [Horario]  -> editor semanal: por día (L-D) lista de ventanas
               hora_inicio–hora_fin, [+ ventana] / [x]. Guarda con PUT (set completo).
  [Bloqueos] -> lista de bloqueos + alta (fecha/hora inicio-fin, motivo, oficina opcional).
```

- "+ Asignar" abre dropdown con profesionales (`/api/professionals`) que aún no están en la
  oficina.
- Crear/editar oficina: formulario con los campos de `createOfficeSchema`
  (nombre, modalidad, dirección, video_link, dias, hora_inicio, hora_fin, slot_min,
  capacidad, buffer_min, activa, orden). `capacidad` se mantiene visible en Fase 1
  (lo usará el motor actual hasta que Fase 2 lo derive de profesionales).

### Cliente API y tipos

- `client/src/lib/api.ts`: extender con `officesApi` (CRUD oficinas + professionals de
  oficina) y `professionalsApi` (list, availability get/put, blocks crud), siguiendo el
  patrón de `teamApi`/`appointmentsApi`.
- Tipos nuevos (en el módulo de tipos del client): `Office`, `OfficeProfessional`,
  `AvailabilityWindow`, `ProfessionalBlock`.

## Manejo de errores

- API: 400 con `{ error }` en validación/Supabase (patrón existente), 404 cuando la
  oficina/asignación/bloqueo no existe, 403 vía `requireRole`.
- UI: `toast.error(e.message)` en fallos, `toast.success` en altas/bajas, estados de
  carga con `Loader2` (igual que `Team.tsx`).
- Asignar un profesional ya asignado: idempotente (upsert), no error.

## Testing

- **Backend** (Vitest, patrón `server/src/api/**/__tests__`):
  - `office_professionals`: asignar, re-asignar (idempotente), quitar, 404 al quitar inexistente.
  - `professionals availability`: PUT reemplaza el set; GET filtra por office_id; rechazo
    de `hora_fin <= hora_inicio` y `dia` fuera de 0-6.
  - `blocks`: alta con/sin office_id, rechazo `end_time <= start_time`, borrado.
- **Migraciones**: aplicar 0018-0020 en Supabase y correr `server/scripts/db-audit.js`
  extendido con marcadores de las tablas nuevas para confirmar.
- **Frontend**: smoke manual del flujo (crear oficina → asignar profesional → cargar
  horario → cargar bloqueo). Sin tests E2E en Fase 1.

## Riesgos / notas

- `profiles` es single-org (sin `account_id`); las oficinas sí son por cuenta. La
  asignación cruza ambos vía `office_professionals`. Un profesional puede estar en oficinas
  de distintas cuentas: aceptado.
- `capacidad` fijo de `account_offices` sigue gobernando el agendado real hasta Fase 2.
  Cargar profesionales/disponibilidad en Fase 1 NO cambia lo que ofrece el agente todavía.
  Esto debe comunicarse para no generar expectativa de que "ya funciona".
- El editor de disponibilidad manda el set completo (PUT reemplaza): evita estados parciales
  pero pisa cambios concurrentes de dos admins; aceptable para el volumen del estudio.

## Entregable

Al cerrar Fase 1: un admin puede, desde el panel, crear oficinas, asignarles profesionales,
y definir el horario y los bloqueos de cada profesional — todo persistido. La base queda
lista para que Fase 2 calcule disponibilidad real y muestre las agendas.

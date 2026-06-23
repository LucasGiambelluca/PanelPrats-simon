# Agendas por oficina con profesionales — Fase 2: Motor real + agenda

Fecha: 2026-06-23
Rama: `feat-omnichannel`
Estado: aprobado (diseño), pendiente de plan de implementación.
Continúa: `2026-06-23-agendas-por-oficina-profesionales-fase1-design.md`.

## Contexto

Fase 1 dejó el modelo de configuración: `office_professionals` (0018),
`professional_availability` (0019), `professional_blocks` (0020), su API admin y la UI
de la página `Oficinas`. Pero el **agendado real no cambió**: sigue gobernando la
`capacidad` fija de `account_offices` y el trigger `check_office_capacity` (0017), que
cuenta solapamientos contra ese número. Cargar profesionales y disponibilidad en Fase 1
NO afecta todavía lo que el agente/flows ofrecen.

Fase 2 conecta esa configuración con el motor: la capacidad de cada slot pasa a derivarse
de los profesionales realmente disponibles, cada reserva queda asignada a una persona, y se
agregan las vistas de calendario (agenda de oficina y agenda personal).

### Decisiones cerradas (brainstorming 2026-06-23)

1. **Capacidad del slot = profesionales disponibles** en ese horario (ventana de
   disponibilidad ∩ slot, menos bloqueos, menos ya-asignados). Si la oficina **no tiene
   profesionales asignados**, se mantiene el modelo viejo (`capacidad` fija) → compat hacia
   atrás.
2. **Auto-asignar al reservar**: el cliente no elige persona; el sistema asigna
   automáticamente un profesional libre en el slot. El admin puede reasignar después.
3. **Alcance = Fase 2 completa**: backend (migración + recálculo + trigger + auto-asignar +
   tools del agente) **y** UI de calendario (agenda oficina + agenda personal) en una tanda.
4. **Calendario = grid propio** en React + Tailwind (sin dependencia nueva). Reasignar por
   dropdown/botón; sin drag-and-drop.
5. **Regla de auto-asignación**: profesional libre con **menos turnos ese día** (balance de
   carga); desempate determinista por nombre. Si no hay profs en la oficina → `assigned_profile_id`
   queda null (pool legacy).
6. **Citas legacy** (`assigned_profile_id` null, reservadas bajo el modelo viejo o en oficina
   sin profs): cada una consume **un cupo genérico** del slot. No se migran retroactivamente.

## Objetivos (Fase 2)

- Capacidad de slot derivada de profesionales disponibles, con fallback a `capacidad` fija.
- Cada reserva nueva queda asignada a un profesional concreto (auto), reasignable por admin.
- Trigger de DB que impide overbooking por persona (no-overlap por profesional) y respeta
  la capacidad derivada / fallback.
- Tools del agente (`check_availability`, `book`, `reschedule`) usan el nuevo cálculo, sin
  cambiar su firma ni exponer elección de persona al cliente.
- Vistas de calendario: **agenda de oficina** (todos los profes) y **agenda personal** (uno),
  con reasignación manual.

## No objetivos

- Que el cliente elija profesional al reservar (sigue siendo pool de oficina).
- Drag-and-drop en el calendario.
- Vista mensual (solo día/semana en Fase 2).
- Migración retroactiva de citas viejas a un profesional.
- Notificaciones al profesional asignado (futuro).
- Validar ventanas de disponibilidad contra el horario de la oficina (el motor intersecta
  igual; sigue la decisión de Fase 1).

## Modelo de datos

### 0021_appointment_assigned_professional.sql

```sql
-- 0021: profesional asignado a una cita + trigger de capacidad por profesionales.
-- Reemplaza la función check_office_capacity (0017). Idempotente.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS assigned_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appt_assigned_prof
  ON appointments(assigned_profile_id, start_time);
```

`assigned_profile_id` NULL = cita legacy / oficina sin profesionales (cuenta como un cupo
genérico). `ON DELETE SET NULL`: si se borra el profile, la cita no se pierde, vuelve a
"sin asignar".

### Trigger nuevo (misma migración 0021)

Reemplaza `check_office_capacity`. Mantiene el advisory lock por (cuenta, oficina). Lógica:

```
BEFORE INSERT OR UPDATE ON appointments:
  si NEW.status = 'cancelada' o sin start/end → RETURN NEW

  pg_advisory_xact_lock(hash(account_id | lower(oficina)))

  -- 1. No-overlap por profesional (si hay persona asignada)
  si NEW.assigned_profile_id IS NOT NULL:
    si existe otra cita (id <> NEW.id, status <> cancelada, mismo assigned_profile_id,
       rangos tstzrange solapan) → RAISE 'professional_busy'

  -- 2. Capacidad de oficina
  n_profs := count(office_professionals activa de esta oficina)   -- por nombre→id de oficina
  si n_profs = 0:
     -- fallback modelo viejo: capacidad fija vs solapamientos totales
     cap := COALESCE(account_offices.capacidad, 1)
     ocupadas := count(citas solapantes de la oficina, id <> NEW.id, no canceladas)
     si ocupadas >= cap → RAISE 'office_capacity_full'
  -- si n_profs > 0: la capacidad real la garantiza (1) no-overlap por persona +
  --   la asignación previa que ya eligió un prof libre. El trigger NO recalcula
  --   disponibilidad horaria (ventanas/bloqueos) — eso lo hace AvailabilityService antes
  --   de asignar. El trigger es la última línea contra doble-booking de una misma persona.

  RETURN NEW
```

Nota de diseño: la **fuente de verdad de disponibilidad horaria** (ventanas + bloqueos) es
`AvailabilityService` en la capa de aplicación, que es quien elige el profesional. El trigger
sólo garantiza la invariante dura e independiente de concurrencia: **una misma persona no
puede tener dos citas solapadas**, y el fallback de capacidad fija para oficinas sin profes.
Esto evita reimplementar la lógica de ventanas/bloqueos en PL/pgSQL.

Para resolver oficina (texto `appointments.oficina`) → `account_offices.id` el trigger hace
`lower(nombre)=lower(oficina) AND account_id` (igual que 0017).

## Backend — AvailabilityService (rewrite)

Archivo: `server/src/services/AvailabilityService.ts`. Se agregan helpers y se reescribe el
cálculo de capacidad/slots para considerar profesionales.

### Nuevas dependencias de datos

- `office_professionals` (profes activos de la oficina).
- `professional_availability` (ventanas por `profile_id, office_id, dia`).
- `professional_blocks` (bloqueos; `office_id` null = todas las oficinas del prof).

### `availableProfessionals(office, start, end): Promise<string[]>`

Devuelve `profile_id[]` que pueden tomar el slot `[start,end)`:

1. Profes con `office_professionals.activa` en la oficina.
2. Que tengan una ventana `professional_availability` para `dia = getDay(start)` cuya
   `[hora_inicio, hora_fin)` **contenga** `[start,end)` (comparación HH:MM local).
3. Que **no** tengan un `professional_blocks` que solape `[start,end)`
   (con `office_id = oficina` o `office_id = null`).
4. Que **no** estén ya asignados (`assigned_profile_id`) a otra cita no cancelada que solape.

### `hasCapacity(office, start, end)` (reescrito)

- Si la oficina **no** tiene profes (`office_professionals` vacío) → comportamiento viejo:
  `countOverlap < capacidad`.
- Si tiene profes → `disponibles = availableProfessionals(...).length`;
  `legacy = count(citas solapantes con assigned_profile_id null)`;
  capacidad libre = `disponibles - legacy`; hay cupo si `> 0`.

### `freeSlots(office, …)` (reescrito)

Igual estructura que hoy (recorre días/slots), pero el filtro de "slot lleno" usa el nuevo
`hasCapacity` por slot. Mantiene `max`, `buffer_min`, ventana de 14 días.

### `pickProfessional(office, start, end): Promise<string | null>`

- Si la oficina no tiene profes → `null`.
- Si tiene → de `availableProfessionals(...)`, elige el de **menos citas ese día** (mismo
  `account_id`, `start_time` en el día local, no cancelada). Desempate determinista por
  nombre ascendente. Si la lista está vacía → `null` (el caller decide si es error de cupo).

### TZ

Decisión heredada de Fase 1/follow-up: `freeSlots` y la comparación de ventanas usan la TZ
del servidor hoy. Fase 2 hace **explícita** la TZ del estudio (America/Argentina/Buenos_Aires)
en un único helper de fecha→(dia, HH:MM) reutilizado por `availableProfessionals` y
`freeSlots`, para que ventanas cargadas como "09:00" se interpreten en hora local del estudio
y no en UTC. Sin esto, profes y slots se desalinean por el offset.

## Backend — Reserva y tools del agente

- **`book`** (tool `AppointmentBookExecutor` / servicio de reserva): después de validar cupo,
  llama `pickProfessional` y guarda `assigned_profile_id` en la cita. Si la oficina tiene
  profes y `pickProfessional` devuelve null → no hay cupo: error de "sin disponibilidad"
  (mismo camino que capacidad llena).
- **`reschedule`**: al mover la cita re-corre `pickProfessional` para el nuevo horario
  (puede cambiar de persona). Si no hay prof libre en el nuevo slot → falla, no mueve.
- **`check_availability`**: usa `freeSlots` reescrito (ya considera profes). Firma y salida
  al cliente sin cambios (sigue devolviendo slots de oficina, sin nombre de persona).
- **`list_offices`**: sin cambios.

Identificación de las tools y el servicio de reserva concretos se resuelve en el plan
(buscar en `server/src/core/executors` y `server/src/core/agent/runtime`).

## API — Agenda y reasignación

Bajo `authContext`. Rol según endpoint.

```
GET /api/offices/:id/agenda?from=<ISO>&to=<ISO>        (admin)
  -> { profesionales: [{ profile_id, name }],
       appointments: [{ id, start_time, end_time, status, assigned_profile_id,
                        cliente_nombre, cliente_telefono }],
       unassigned: [...]  // appointments de la oficina con assigned_profile_id null }
  Citas de la oficina (match por nombre) en el rango [from,to].

GET /api/professionals/:id/agenda?from=<ISO>&to=<ISO>  (admin, o la propia empleada)
  -> { appointments: [...] } del profesional en el rango.
  RBAC: admin cualquiera; rol empleada solo si :id = su propio profile.

PATCH /api/appointments/:id/assign   body { profile_id: uuid | null }   (admin)
  -> reasigna. Valida (vía trigger / chequeo previo) que el prof no quede solapado:
     si está ocupado → 409 'professional_busy'. profile_id null = desasignar.
```

Validación Zod: `assignSchema = { profile_id: string.uuid().nullable() }`. Rango `from/to`
requeridos ISO; `to > from`; tope de rango (ej. 31 días) para acotar la consulta.

Wiring en `app.ts` junto a los routers de Fase 1. La agenda de oficina puede vivir en el
`officesRouter`/`officeProfessionalsRouter` existente; el `assign` en el router de
appointments existente.

## Frontend — Vistas de calendario

Stack y patrón de Fase 1 (React + Vite + TS + Tailwind `brand-*` + react-router + `sonner` +
`lucide-react`). Sin dependencia de calendario nueva: **grid propio**.

### Componentes

- `client/src/components/agenda/WeekGrid.tsx`: grilla reutilizable. Props: rango (día o
  semana), columnas (lista de {id, label}), eventos ({id, columnId, start, end, label,
  status}), `onEventClick`. Filas = horas (según `slot_min`/horario de oficina), columnas
  configurables. Render con CSS grid; eventos posicionados por hora.
- `client/src/components/agenda/AssignDropdown.tsx`: dado un appointment, lista profes libres
  en ese slot (consulta `/agenda` o un endpoint de candidatos) y llama `PATCH .../assign`.

### Páginas / rutas (admin)

- **Agenda de oficina**: dentro de la página `Oficinas` (tab "Agenda" en el detalle de
  oficina) o ruta `/offices/:id/agenda`. Columnas = profesionales de la oficina + columna
  "Sin asignar" para legacy. Selector día/semana y navegación ‹ ›. Click en turno → detalle +
  `AssignDropdown` para reasignar.
- **Agenda personal**: ruta `/agenda` (o tab). Admin elige profesional (selector); rol
  empleada ve directamente la propia (sin selector). Una columna, vista día/semana.

### Cliente API y tipos

- `client/src/lib/api.ts`: extender con `agendaApi` (office agenda, professional agenda,
  assign), siguiendo el patrón de `officesApi`/`professionalsApi` de Fase 1.
- Tipos: `AgendaResponse`, `AgendaAppointment`, reusar `OfficeProfessional`.

## Manejo de errores

- API: 400 validación, 403 `requireRole`/RBAC empleada-ajena, 404 oficina/cita inexistente,
  409 `professional_busy` al reasignar a prof ocupado.
- Reserva sin cupo (oficina con profes, ninguno libre): mismo mensaje "sin disponibilidad"
  que capacidad llena hoy; el agente ofrece otros slots.
- UI: `toast.error(e.message)` / `toast.success`, `Loader2` en carga (igual que Fase 1).

## Testing

- **AvailabilityService** (Vitest): `availableProfessionals` (ventana cubre/no cubre, bloqueo
  solapa, prof ya asignado excluido); `hasCapacity` con profes (cupo = disponibles − legacy) y
  fallback sin profes; `pickProfessional` (balance menos-turnos + desempate determinista, null
  sin profes); `freeSlots` respeta lo anterior; TZ local correcta.
- **Trigger** (test de integración / SQL): no-overlap por profesional (rechaza segunda cita
  solapada del mismo prof = `professional_busy`); fallback capacidad fija en oficina sin
  profes; permite dos citas solapadas si son de profes distintos.
- **Reserva/tools**: `book` setea `assigned_profile_id`; sin prof libre → error de cupo;
  `reschedule` reasigna en el nuevo slot.
- **API**: `/agenda` oficina y personal (RBAC empleada propia vs ajena → 403); `assign` ok,
  desasignar (null), reasignar a ocupado → 409.
- **Migración**: aplicar 0021 en Supabase y extender `server/scripts/db-audit.js` con
  marcadores de `assigned_profile_id` + función/trigger nuevos.
- **Frontend**: smoke manual (reservar desde el agente → aparece asignado en la agenda de
  oficina → reasignar a otro prof → aparece en su agenda personal).

## Riesgos / notas

- **Doble verdad de disponibilidad**: ventanas/bloqueos viven en la app (AvailabilityService),
  no en el trigger. Aceptado: el trigger sólo garantiza no-overlap por persona + fallback.
  Riesgo residual: si dos reservas concurrentes eligen el último prof libre en el mismo slot,
  el advisory lock + no-overlap por persona las serializa y la segunda falla → correcto.
- **Citas legacy** sin `assigned_profile_id` siguen consumiendo cupo genérico; conviven con el
  modelo por-profesional hasta que se cancelen/pasen. No se migran.
- **`appointments.oficina` es texto**: el match oficina↔profes depende del nombre. Si se
  renombra una oficina, las citas viejas quedan con el nombre histórico (igual que hoy).
- **TZ**: hacerla explícita es bloqueante para que ventanas y slots coincidan; es el mayor
  riesgo de bug silencioso si se omite.
- **`capacidad` fija** queda en el modelo de datos y la UI como fallback (oficinas sin profes);
  no se borra en Fase 2.

## Entregable

Al cerrar Fase 2: una oficina con profesionales y horarios cargados ofrece slots según
disponibilidad real; cada reserva del agente queda asignada a una persona concreta (auto,
balanceada); el admin ve la agenda de la oficina y la de cada profesional, y puede reasignar
turnos. Las oficinas sin profesionales siguen funcionando con el modelo de capacidad fija.

# Agenda — Selector multi-agenda (estilo Google Calendar) + zoom en vista Día

**Fecha:** 2026-06-26
**Archivo afectado:** `client/src/pages/Agenda.tsx` (único). Sin cambios de backend.

## Problema

El cliente pide dos mejoras de UI en la Agenda:

1. **Multi-agenda (admin):** poder ver todas las agendas, un par, o una sola — tal cual Google Calendar. Hoy el admin solo puede filtrar **una** agenda (profesional) a la vez mediante un `<select>` en el header. Las empleadas siguen viendo solo su propia agenda.
2. **Vista Día legible:** cuando hay varias citas en horas cercanas, se ven amontonadas e ilegibles. Se quiere poder **acercar (zoom)** la grilla horaria para separar las citas, con líneas de media hora.

## Contexto del código actual

La Agenda es un clon de Google Calendar **construido a mano** (no usa FullCalendar ni librería). Puntos relevantes:

- `client/src/pages/Agenda.tsx`
  - Estado `profFilter: string` (`''` = todos). Filtro aplicado client-side en el `.filter()` de `filteredAppointments` (~línea 290): `const matchesProf = !profFilter || app.assigned_profile_id === profFilter;`
  - Las citas ya se cargan **todas** para la cuenta (o todas las líneas) y se filtran en memoria. **El filtrado por agenda es 100% client-side.**
  - Admin: dropdown `<select>` de profesionales en el header (~líneas 985-997).
  - Empleada: `setProfFilter(user.id)` la bloquea a su agenda (~línea 211).
  - `professionalsApi.list()` carga la lista global de profesionales para el admin (~línea 209).
  - Constante `HOUR_HEIGHT = 68` (línea 41) — alto en px de cada fila de hora. Toda la matemática de posicionamiento de eventos (`getEventLayout`, `getPositionedEvents`, `getRedTimeLinePosition`, render de grilla en semana/día) deriva de esta constante.
  - `getEventStyle(status)` (~línea 549) y `getMonthPillStyle(status)` (~línea 567) colorean las citas **por estado** (confirmada/pendiente/cancelada/asistió/no_asistió/cerrado).
  - Vistas: `month` | `week` | `day` | `list`. Día y Semana usan grilla horaria absoluta (7:00–22:00, `hours = [7..22]`).
  - Sidebar izquierda tiene una sección titulada **"Mis Calendarios"** que en realidad son **checkboxes de estado** (no de agendas).

- `server/src/api/routes/agenda.routes.ts` — endpoints de agenda por oficina/profesional. **No se tocan**: el filtrado multi-agenda es client-side sobre las citas ya cargadas.

## "Agenda" = profesional

En este dominio cada **profesional** (`profiles`, vínculo `appointments.assigned_profile_id`) equivale a un "calendario"/"agenda" de Google Calendar. Las citas sin `assigned_profile_id` son una pseudo-agenda **"Sin asignar"**.

---

## Decisiones de diseño (confirmadas con el usuario)

1. **Color de citas:** color **por profesional** (como Google). El **estado** pasa a un **badge/ícono chico** dentro de la cita.
2. **Vista Día:** **control de zoom (+/−)** que agranda el alto de la hora + **líneas de media hora**. (Se descartó la opción de columnas por profesional.)

---

## Diseño

### 1. Selección multi-agenda

**Estado**
- Reemplazar `profFilter: string` por `selectedProfs: Set<string>` = conjunto de ids de profesional **visibles**.
- Constante centinela para citas sin asignar: `const UNASSIGNED = '__unassigned__'`. Se incluye en el `Set` como un id más cuando "Sin asignar" está activo.

**Inicialización**
- **Admin:** al cargar la lista de profesionales, `selectedProfs` arranca con **todos** los ids + `UNASSIGNED` (todo visible por defecto).
- **Empleada:** `selectedProfs = new Set([user.id])`. Sin acceso al selector (ve solo su agenda). Mantiene el comportamiento actual.

**Filtro** (reemplaza la línea ~290)
```ts
const matchesProf = selectedProfs.has(app.assigned_profile_id ?? UNASSIGNED);
```

**UI — sidebar**
- Nueva sección **"Agendas"** en la sidebar izquierda, **arriba** de "Mis Calendarios". Solo visible para `role === 'admin'`.
- Por cada profesional: un `label` con checkbox + **cuadradito del color** del profesional + nombre. Estilo idéntico a los checkboxes existentes de "Mis Calendarios" (reusar el patrón visual del checkbox custom).
- Entrada extra **"Sin asignar"** (color gris) que togglea `UNASSIGNED`.
- Fila master **"Todas"**: marca/desmarca todo de una. Estado derivado (checked si todos seleccionados, indeterminate si parcial).
- **Quitar** el `<select>` de profesional del header (~líneas 985-997) — su función ahora vive en la sidebar.

**Helper de toggle**
- `toggleProf(id)`: agrega/quita `id` del `Set` (clonando el Set para disparar re-render).
- `toggleAll()`: si todos seleccionados → vaciar (dejar solo… ver nota); si no → seleccionar todos + `UNASSIGNED`.
  - Nota: "vaciar" deja el calendario sin citas visibles (válido, igual que Google al desmarcar todo).

### 2. Color por profesional

**Paleta**
- Definir una paleta fija de ~14 colores, cada uno con variantes para tema claro y oscuro, en la forma que ya usa `getEventStyle` (clases Tailwind: fondo + borde izquierdo + texto + hover). Inspirada en la paleta de Google Calendar.
- `profColor(profileId: string | null)`: índice estable derivado de la **posición del profesional en la lista ordenada** (orden por `id` para estabilidad), módulo largo de paleta. `null`/sin asignar → **gris**.
- Construir un `Map<profileId, paletteEntry>` una vez que `professionals` está cargado (memoizado).

**Aplicación**
- `getEventStyle` deja de depender de `status` y pasa a depender del **profesional de la cita** (`app.assigned_profile_id`).
- `getMonthPillStyle` (pills de vista Mes): igual, color por profesional.
- **Estado → badge:** dentro de cada cita (semana/día) y como ícono en la pill (mes), mostrar un indicador chico del estado:
  - confirmada → ✓ (check)
  - pendiente → ● (punto/clock)
  - cancelada → ✕
  - asistió → check azul / UserCheck
  - no_asistió → reloj/alerta
  - cerrado → check doble
  - Reusar los íconos de `lucide-react` ya importados donde aplique. El badge va en una esquina de la cita, tamaño chico, sin romper el layout existente.
- **"Mis Calendarios"** (checkboxes de estado) **se mantiene tal cual** como filtro de estado. No afecta color. Los colores fijos de sus cuadraditos (emerald/amber/red/…) representan estado y siguen siendo válidos como leyenda de estado.

### 3. Zoom en vista Día (y Semana)

**Estado**
- `HOUR_HEIGHT` (const) → `hourHeight: number` (estado), inicial 68, persistido en `localStorage` (`agenda_hour_height`).
- Niveles discretos: `[40, 56, 68, 96, 128, 160]` px. `+`/`−` se mueve al nivel siguiente/anterior; clamp en los extremos. Default 68 (nivel actual).

**Control**
- Botones **−/+** (y opcionalmente un valor o barra) en el header de la vista **Día**. Visibles cuando `view === 'day'` (y se pueden mostrar también en `week`).
- `zoomIn()` / `zoomOut()` con clamp al rango; persistir a localStorage.

**Líneas de media hora**
- En el render de la grilla (semana y día), agregar una línea **dasheada** a la mitad de cada bloque de hora (`top + hourHeight/2`), color tenue, sin borde fuerte.

**Matemática**
- Toda la matemática (`getEventLayout`, `getPositionedEvents`, `getRedTimeLinePosition`, `style={{ height: hours.length * hourHeight }}`, tops de grilla) usa `hourHeight` en lugar de la constante. Cambio mecánico: reemplazar referencias a `HOUR_HEIGHT` por la variable de estado.
- El auto-scroll inicial a las 8 AM (~línea 178) usa `hourHeight` en vez del literal `68`.

---

## Aislamiento y testeo

- **Helpers puros** extraíbles y testeables sin React:
  - `profColor(orderedProfIds, profileId) → paletteIndex` (o el `Map`).
  - El predicado de filtro de agenda (función pura `isProfVisible(selectedProfs, app)`).
- El resto es UI dentro del componente. No hay suite de tests de frontend en el repo actualmente; la verificación de la UI es **manual** (ver Plan de verificación). Si se extraen los helpers a un módulo, se les puede agregar un test unitario liviano (Vitest/Jest según config del cliente — verificar antes).

## Plan de verificación (manual)

1. **Admin, todas las agendas:** todas las citas visibles, cada profesional con su color; "Sin asignar" en gris.
2. **Admin, un par:** desmarcar algunos → solo quedan las citas de los profesionales marcados. "Todas" refleja estado parcial.
3. **Admin, una:** dejar una marcada → equivalente al filtro viejo.
4. **Empleada:** no ve la sección "Agendas"; solo ve su propia agenda; no puede ver otras.
5. **Estado visible:** el badge de estado se ve en mes/semana/día y sigue distinguiendo confirmada/pendiente/etc.
6. **Filtro de estado:** los checkboxes de "Mis Calendarios" siguen ocultando/mostrando por estado, combinados con la selección de agendas.
7. **Zoom día:** +/− cambia el alto de la hora, las citas amontonadas se separan y quedan legibles; persiste tras recargar; líneas de media hora visibles; línea roja "ahora" y auto-scroll siguen alineados.

## Fuera de alcance (YAGNI)

- Sin cambios de backend ni de esquema de DB.
- Sin columnas por profesional en vista Día (descartado).
- Sin persistir la selección de agendas en servidor (es estado de UI por sesión; opcional persistir en localStorage si se desea, pero no requerido).
- Sin colores configurables por el usuario (paleta fija asignada automáticamente).

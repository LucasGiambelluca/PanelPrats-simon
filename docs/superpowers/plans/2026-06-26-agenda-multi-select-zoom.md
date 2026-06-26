# Agenda Multi-Agenda + Zoom Día — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar al admin un selector multi-agenda estilo Google Calendar (todas/varias/una), colorear las citas por profesional con el estado en un badge, y agregar control de zoom + líneas de media hora en la vista Día. Las empleadas siguen viendo solo su agenda.

**Architecture:** Todo client-side en `client/src/pages/Agenda.tsx`. Las citas ya se cargan completas y se filtran en memoria, así que el multi-select es solo estado de UI. Sin cambios de backend ni de DB.

**Tech Stack:** React + TypeScript + Vite + Tailwind CSS + lucide-react. **No hay test runner en `client/`** — la verificación automatizada es el compilador (`npm run build`, que corre `tsc -b`) y la verificación funcional es manual en el navegador (`npm run dev`).

**Nota sobre "tests":** Este componente no tiene suite de tests y el cliente no tiene runner configurado. No se agrega infraestructura de testing (YAGNI). El gate de cada tarea es: **compila (`tsc`) sin errores** + **commit**. La verificación funcional manual va en la Tarea 6.

---

## File Structure

- **Modify:** `client/src/pages/Agenda.tsx` — único archivo. Cambios:
  - Helpers puros nuevos arriba del componente: paleta de colores, `profColorIndex`, `isProfVisible`, constante `UNASSIGNED`.
  - Estado: `profFilter: string` → `selectedProfs: Set<string>`; `HOUR_HEIGHT` const → `hourHeight` estado.
  - Sidebar: nueva sección "Agendas" (admin).
  - Header: quitar `<select>` de profesional.
  - Render de citas (mes/semana/día): color por profesional + badge de estado.
  - Grilla semana/día: usar `hourHeight`, agregar líneas de media hora, control +/− en vista Día.

Es un archivo grande (~1860 líneas) pero los cambios están localizados; no se reestructura.

---

## Task 1: Helpers puros (paleta, color por profesional, filtro, centinela)

**Files:**
- Modify: `client/src/pages/Agenda.tsx` (zona de helpers de módulo, después de `const HOUR_HEIGHT = 68;` en línea ~41)

- [ ] **Step 1: Agregar constantes y helpers puros de módulo**

Insertar después de la línea `const HOUR_HEIGHT = 68; // height in pixels of an hour row` (línea ~41):

```ts
// Pseudo-agenda para citas sin profesional asignado.
const UNASSIGNED = '__unassigned__';

// Niveles discretos de zoom (alto de la fila de una hora, en px).
const ZOOM_LEVELS = [40, 56, 68, 96, 128, 160];

// Paleta fija de "agendas" (una por profesional), estilo Google Calendar.
// Cada entrada trae clases Tailwind para tema claro y oscuro: fondo + borde
// izquierdo + texto + hover. El último elemento (gris) es para "Sin asignar".
type ProfPalette = { light: string; dark: string; swatch: string };
const PROF_PALETTE: ProfPalette[] = [
  { light: 'bg-[#e8f0fe] border-l-[4px] border-[#1a73e8] text-[#1a4fa0] hover:bg-[#1a73e8]/10', dark: 'bg-blue-500/10 border-l-[4px] border-blue-500 text-blue-300 hover:bg-blue-500/20', swatch: 'bg-[#1a73e8]' },
  { light: 'bg-[#e6f4ea] border-l-[4px] border-[#137333] text-[#0f5927] hover:bg-[#137333]/10', dark: 'bg-emerald-500/10 border-l-[4px] border-emerald-500 text-emerald-300 hover:bg-emerald-500/20', swatch: 'bg-[#137333]' },
  { light: 'bg-[#fce8e6] border-l-[4px] border-[#c5221f] text-[#a11b19] hover:bg-[#c5221f]/10', dark: 'bg-red-500/10 border-l-[4px] border-red-500 text-red-300 hover:bg-red-500/20', swatch: 'bg-[#c5221f]' },
  { light: 'bg-[#fff3e0] border-l-[4px] border-[#e8710a] text-[#b45309] hover:bg-[#e8710a]/10', dark: 'bg-orange-500/10 border-l-[4px] border-orange-500 text-orange-300 hover:bg-orange-500/20', swatch: 'bg-[#e8710a]' },
  { light: 'bg-[#f3e8fd] border-l-[4px] border-[#8430ce] text-[#6b21a8] hover:bg-[#8430ce]/10', dark: 'bg-purple-500/10 border-l-[4px] border-purple-500 text-purple-300 hover:bg-purple-500/20', swatch: 'bg-[#8430ce]' },
  { light: 'bg-[#e0f7f6] border-l-[4px] border-[#009688] text-[#00695c] hover:bg-[#009688]/10', dark: 'bg-teal-500/10 border-l-[4px] border-teal-500 text-teal-300 hover:bg-teal-500/20', swatch: 'bg-[#009688]' },
  { light: 'bg-[#fde7f3] border-l-[4px] border-[#d81b60] text-[#ad1457] hover:bg-[#d81b60]/10', dark: 'bg-pink-500/10 border-l-[4px] border-pink-500 text-pink-300 hover:bg-pink-500/20', swatch: 'bg-[#d81b60]' },
  { light: 'bg-[#fef7e0] border-l-[4px] border-[#b06000] text-[#8e4d00] hover:bg-[#b06000]/10', dark: 'bg-amber-500/10 border-l-[4px] border-amber-500 text-amber-300 hover:bg-amber-500/20', swatch: 'bg-[#b06000]' },
  { light: 'bg-[#e8eaf6] border-l-[4px] border-[#3f51b5] text-[#283593] hover:bg-[#3f51b5]/10', dark: 'bg-indigo-500/10 border-l-[4px] border-indigo-500 text-indigo-300 hover:bg-indigo-500/20', swatch: 'bg-[#3f51b5]' },
  { light: 'bg-[#f1f8e9] border-l-[4px] border-[#689f38] text-[#33691e] hover:bg-[#689f38]/10', dark: 'bg-lime-500/10 border-l-[4px] border-lime-500 text-lime-300 hover:bg-lime-500/20', swatch: 'bg-[#689f38]' },
  { light: 'bg-[#e0f2f1] border-l-[4px] border-[#00838f] text-[#006064] hover:bg-[#00838f]/10', dark: 'bg-cyan-500/10 border-l-[4px] border-cyan-500 text-cyan-300 hover:bg-cyan-500/20', swatch: 'bg-[#00838f]' },
  { light: 'bg-[#fbe9e7] border-l-[4px] border-[#d84315] text-[#bf360c] hover:bg-[#d84315]/10', dark: 'bg-rose-500/10 border-l-[4px] border-rose-500 text-rose-300 hover:bg-rose-500/20', swatch: 'bg-[#d84315]' },
  { light: 'bg-[#ede7f6] border-l-[4px] border-[#5e35b1] text-[#4527a0] hover:bg-[#5e35b1]/10', dark: 'bg-violet-500/10 border-l-[4px] border-violet-500 text-violet-300 hover:bg-violet-500/20', swatch: 'bg-[#5e35b1]' },
  { light: 'bg-[#e3f2fd] border-l-[4px] border-[#0277bd] text-[#01579b] hover:bg-[#0277bd]/10', dark: 'bg-sky-500/10 border-l-[4px] border-sky-500 text-sky-300 hover:bg-sky-500/20', swatch: 'bg-[#0277bd]' },
];
// Color gris para "Sin asignar".
const UNASSIGNED_PALETTE: ProfPalette = {
  light: 'bg-slate-100 border-l-[4px] border-slate-400 text-slate-600 hover:bg-slate-200',
  dark: 'bg-white/5 border-l-[4px] border-slate-500 text-slate-300 hover:bg-white/10',
  swatch: 'bg-slate-400',
};

// Índice de color estable de un profesional, según su posición en la lista
// ordenada por id. Devuelve la entrada gris si no hay profesional (sin asignar).
function profPalette(orderedProfIds: string[], profileId: string | null | undefined): ProfPalette {
  if (!profileId) return UNASSIGNED_PALETTE;
  const idx = orderedProfIds.indexOf(profileId);
  if (idx < 0) return UNASSIGNED_PALETTE;
  return PROF_PALETTE[idx % PROF_PALETTE.length];
}

// Predicado puro: ¿la cita es visible según las agendas seleccionadas?
function isProfVisible(selectedProfs: Set<string>, assignedProfileId: string | null | undefined): boolean {
  return selectedProfs.has(assignedProfileId ?? UNASSIGNED);
}
```

- [ ] **Step 2: Verificar que compila**

Run: `cd client && npm run build`
Expected: compila sin errores nuevos (los helpers todavía no se usan; TypeScript no marca funciones de módulo sin usar). Si `tsc` se queja de imports sin usar, ignorar por ahora — se usan en tareas siguientes. Si falla por OTRA razón, corregir.

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Agenda.tsx
git commit -m "feat(agenda): helpers de paleta por profesional + filtro multi-agenda"
```

---

## Task 2: Estado `selectedProfs` y filtro multi-agenda

**Files:**
- Modify: `client/src/pages/Agenda.tsx` (estado ~línea 116, efecto de carga ~línea 207, filtro ~línea 290)

- [ ] **Step 1: Reemplazar el estado `profFilter`**

Línea ~116, reemplazar:
```ts
const [profFilter, setProfFilter] = useState<string>(''); // '' = todos
```
por:
```ts
// Agendas (profesionales) visibles. Admin: arranca con todas + sin-asignar.
// Empleada: bloqueada a su propia agenda.
const [selectedProfs, setSelectedProfs] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Derivar lista ordenada de ids de profesional (memo)**

Justo después de la línea de estado `const [professionals, setProfessionals] = useState<ProfessionalLite[]>([]);` (~línea 115) NO se puede poner el memo (los hooks van dentro del cuerpo). En su lugar, agregar el memo cerca del resto de derivados, después del bloque de estados (p. ej. antes de `const statusLabel` ~línea 220). Agregar:

```ts
// Ids de profesional ordenados de forma estable (por id) para asignar colores.
const orderedProfIds = useMemo(
  () => professionals.map((p) => p.id).sort(),
  [professionals],
);
```

Y agregar `useMemo` al import de React en la línea 1:
```ts
import { useState, useEffect, useRef, useMemo } from 'react';
```

- [ ] **Step 3: Inicializar `selectedProfs` según rol**

Reemplazar el efecto de ~línea 207-213:
```ts
  // Load professionals (admin) o bloquear a la agenda propia (empleada)
  useEffect(() => {
    if (role === 'admin') {
      professionalsApi.list().then(setProfessionals).catch(() => {});
    } else if (user) {
      setProfFilter(user.id); // empleada: agenda propia
    }
  }, [role, user]);
```
por:
```ts
  // Load professionals (admin) o bloquear a la agenda propia (empleada)
  useEffect(() => {
    if (role === 'admin') {
      professionalsApi.list()
        .then((profs) => {
          setProfessionals(profs);
          // Admin: arranca con todas las agendas + "sin asignar" visibles.
          setSelectedProfs(new Set([...profs.map((p) => p.id), UNASSIGNED]));
        })
        .catch(() => {});
    } else if (user) {
      setSelectedProfs(new Set([user.id])); // empleada: solo su agenda
    }
  }, [role, user]);
```

- [ ] **Step 4: Actualizar el filtro de citas**

Línea ~290, reemplazar:
```ts
    const matchesProf = !profFilter || app.assigned_profile_id === profFilter;
```
por:
```ts
    const matchesProf = isProfVisible(selectedProfs, app.assigned_profile_id);
```

- [ ] **Step 5: Verificar que compila**

Run: `cd client && npm run build`
Expected: compila. Puede quedar el `<select>` del header referenciando `profFilter`/`setProfFilter` → ESO dará error de compilación porque ya no existen. Si aparece, NO arreglar el select acá: se elimina en la Tarea 3, Step 2. Para mantener el build verde entre tareas, hacer el Step de la Tarea 3 que elimina el select **antes** de compilar/commitear. → Saltar el commit hasta completar Tarea 3 Step 2, o comentar temporalmente el bloque del select. **Recomendado:** continuar directo a Tarea 3 y compilar/commitear juntas las Tareas 2+3.

---

## Task 3: Sidebar "Agendas" + quitar el `<select>` del header

**Files:**
- Modify: `client/src/pages/Agenda.tsx` (sidebar ~línea 749, header select ~línea 985)

- [ ] **Step 1: Agregar helpers de toggle (dentro del componente)**

Agregar cerca de los otros handlers (p. ej. después de `toggleTheme`, ~línea 130):
```ts
  const toggleProf = (id: string) => {
    setSelectedProfs((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const allProfKeys = () => [...professionals.map((p) => p.id), UNASSIGNED];
  const allSelected = professionals.length > 0 && allProfKeys().every((k) => selectedProfs.has(k));
  const toggleAllProfs = () => {
    setSelectedProfs(() => (allSelected ? new Set<string>() : new Set(allProfKeys())));
  };
```

- [ ] **Step 2: Quitar el `<select>` de profesional del header**

Eliminar el bloque ~líneas 984-997:
```tsx
            {/* Professional filter (admin only) */}
            {role === 'admin' && (
              <select
                value={profFilter}
                onChange={(e) => setProfFilter(e.target.value)}
                className={`border rounded-xl px-3 py-1.5 text-xs font-bold ${theme === 'light' ? 'bg-slate-100 border-slate-200 text-slate-700' : 'bg-white/5 border-white/10 text-brand-textLight'}`}
                title="Filtrar por profesional"
              >
                <option value="">Todos los profesionales</option>
                {professionals.map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            )}
```
(Borrar completo. El multi-select vive ahora en la sidebar.)

- [ ] **Step 3: Agregar la sección "Agendas" en la sidebar**

Insertar **antes** del bloque `{/* MIS CALENDARIOS ... */}` (~línea 749), dentro del contenedor de la sidebar. Solo para admin:

```tsx
        {/* AGENDAS (multi-select de profesionales, estilo Google Calendar) */}
        {role === 'admin' && professionals.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between px-1">
              <h3 className={`text-[10px] font-bold uppercase tracking-widest flex items-center gap-1.5 ${
                theme === 'light' ? 'text-slate-400' : 'text-brand-secondary/80'
              }`}>
                <CalendarDays size={10} />
                <span>Agendas</span>
              </h3>
              <button
                onClick={toggleAllProfs}
                className={`text-[10px] font-bold ${theme === 'light' ? 'text-[#1a73e8] hover:underline' : 'text-brand-secondary hover:underline'}`}
              >
                {allSelected ? 'Ninguna' : 'Todas'}
              </button>
            </div>
            <div className="space-y-2.5 px-1 max-h-56 overflow-y-auto scrollbar-thin">
              {professionals.map((p) => {
                const checked = selectedProfs.has(p.id);
                const swatch = profPalette(orderedProfIds, p.id).swatch;
                return (
                  <label key={p.id} className={`flex items-center gap-3 cursor-pointer text-xs font-semibold select-none group ${
                    theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-brand-textMuted hover:text-white'
                  }`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleProf(p.id)} className="sr-only" />
                    <div className={`w-4 h-4 rounded-md flex items-center justify-center transition-all ${
                      checked ? `${swatch} text-white` : theme === 'light' ? 'border border-slate-300 group-hover:border-slate-400' : 'border border-white/20 group-hover:border-white/40'
                    }`}>
                      {checked && <Check size={10} className="stroke-[3]" />}
                    </div>
                    <span className="truncate">{p.name}</span>
                  </label>
                );
              })}
              {/* Sin asignar */}
              {(() => {
                const checked = selectedProfs.has(UNASSIGNED);
                return (
                  <label className={`flex items-center gap-3 cursor-pointer text-xs font-semibold select-none group ${
                    theme === 'light' ? 'text-slate-600 hover:text-slate-900' : 'text-brand-textMuted hover:text-white'
                  }`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleProf(UNASSIGNED)} className="sr-only" />
                    <div className={`w-4 h-4 rounded-md flex items-center justify-center transition-all ${
                      checked ? 'bg-slate-400 text-white' : theme === 'light' ? 'border border-slate-300 group-hover:border-slate-400' : 'border border-white/20 group-hover:border-white/40'
                    }`}>
                      {checked && <Check size={10} className="stroke-[3]" />}
                    </div>
                    <span className="italic opacity-80">Sin asignar</span>
                  </label>
                );
              })()}
            </div>
          </div>
        )}

```

- [ ] **Step 4: Verificar que compila**

Run: `cd client && npm run build`
Expected: compila sin errores. Ya no quedan referencias a `profFilter`/`setProfFilter`.

- [ ] **Step 5: Commit**

```bash
git add client/src/pages/Agenda.tsx
git commit -m "feat(agenda): selector multi-agenda en sidebar (admin) + quita select de header"
```

---

## Task 4: Color por profesional + badge de estado

**Files:**
- Modify: `client/src/pages/Agenda.tsx` (`getEventStyle` ~549, `getMonthPillStyle` ~567, renders de mes/semana/día)

- [ ] **Step 1: Reescribir `getEventStyle` para colorear por profesional**

Reemplazar la función `getEventStyle` (~líneas 548-565) por:
```tsx
  // Estilo de la cita: color POR PROFESIONAL (el estado va en un badge aparte).
  const getEventStyle = (app: Appointment) => {
    const pal = profPalette(orderedProfIds, app.assigned_profile_id);
    return theme === 'light' ? pal.light : pal.dark;
  };
```

- [ ] **Step 2: Reescribir `getMonthPillStyle` para colorear por profesional**

Reemplazar `getMonthPillStyle` (~líneas 567-583) por:
```tsx
  // Pill de vista Mes: fondo sólido del color del profesional.
  const getMonthPillStyle = (app: Appointment) => {
    const swatch = profPalette(orderedProfIds, app.assigned_profile_id).swatch;
    return `${swatch} text-white hover:opacity-90`;
  };
```

- [ ] **Step 3: Agregar helper de badge de estado (dentro del componente)**

Agregar después de `getMonthPillStyle`:
```tsx
  // Ícono chico que representa el estado de la cita (el color ya lo da el profesional).
  const StatusBadge = ({ status, size = 11 }: { status: string; size?: number }) => {
    const common = 'inline-flex items-center justify-center rounded-full';
    if (status === 'confirmada') return <span className={`${common} text-emerald-600`} title="Confirmada"><CheckCircle size={size} /></span>;
    if (status === 'cancelada') return <span className={`${common} text-red-600`} title="Cancelada"><XCircle size={size} /></span>;
    if (status === 'asistio') return <span className={`${common} text-blue-600`} title="Asistió"><UserCheck size={size} /></span>;
    if (status === 'no_asistio') return <span className={`${common} text-orange-600`} title="No asistió"><Clock size={size} /></span>;
    if (status === 'cerrado') return <span className={`${common} text-emerald-700`} title="Cerrado"><Check size={size} className="stroke-[3]" /></span>;
    return <span className={`${common} text-amber-600`} title="Pendiente"><Clock size={size} /></span>;
  };
```

- [ ] **Step 4: Actualizar las llamadas a `getEventStyle(app.status)` → `getEventStyle(app)`**

Hay dos usos (vista semana ~línea 1177 y vista día ~línea 1270). Reemplazar en ambos:
```tsx
${getEventStyle(app.status)}
```
por:
```tsx
${getEventStyle(app)}
```

- [ ] **Step 5: Agregar el badge de estado en la cita de la vista Semana**

En la vista Semana (~líneas 1180-1184), reemplazar:
```tsx
                              <div className="flex items-start justify-between">
                                <span className={`font-bold text-[10px] leading-tight block truncate ${
                                  theme === 'light' ? 'text-slate-800 font-extrabold' : 'text-white'
                                }`}>{app.nombre}</span>
                              </div>
```
por:
```tsx
                              <div className="flex items-start justify-between gap-1">
                                <span className={`font-bold text-[10px] leading-tight block truncate ${
                                  theme === 'light' ? 'text-slate-800 font-extrabold' : 'text-white'
                                }`}>{app.nombre}</span>
                                <StatusBadge status={app.status} size={10} />
                              </div>
```

- [ ] **Step 6: Reemplazar el badge de estado en la vista Día**

En la vista Día (~líneas 1273-1286), el `<span>` que muestra `app.status` como texto ya existe. Reemplazar ese span de status (el bloque `<span className={...uppercase...}>{app.status}</span>`) por el componente:
```tsx
                          <StatusBadge status={app.status} size={14} />
```
(Quitar el `<span>` largo con clases condicionales de color por status — el color ahora lo da el profesional, y el estado lo da el badge.)

- [ ] **Step 7: Actualizar la pill de la vista Mes (color + ícono de estado)**

En la vista Mes (~líneas 1074-1083), reemplazar:
```tsx
                            <div
                              key={app.id}
                              onClick={(e) => handleEditClick(app, e)}
                              className={`text-[8.5px] font-bold py-0.5 px-1.5 rounded truncate leading-tight flex items-center gap-1 ${getMonthPillStyle(app.status)}`}
                              title={`${app.nombre} (${app.status})`}
                            >
                              <span className="font-mono text-[8px] opacity-75">{hr}</span>
                              <span>{app.nombre}</span>
                            </div>
```
por:
```tsx
                            <div
                              key={app.id}
                              onClick={(e) => handleEditClick(app, e)}
                              className={`text-[8.5px] font-bold py-0.5 px-1.5 rounded truncate leading-tight flex items-center gap-1 ${getMonthPillStyle(app)}`}
                              title={`${app.nombre} (${app.status})`}
                            >
                              <span className="font-mono text-[8px] opacity-75">{hr}</span>
                              <span className="truncate flex-1">{app.nombre}</span>
                            </div>
```
(El color de la pill ya distingue al profesional; el `title` conserva el estado en hover. No se agrega ícono acá para no romper el layout de 8.5px.)

- [ ] **Step 8: Verificar que compila**

Run: `cd client && npm run build`
Expected: compila sin errores. No deben quedar llamadas `getEventStyle(app.status)` ni `getMonthPillStyle(app.status)`.

- [ ] **Step 9: Commit**

```bash
git add client/src/pages/Agenda.tsx
git commit -m "feat(agenda): citas coloreadas por profesional + estado en badge"
```

---

## Task 5: Zoom en vista Día + líneas de media hora

**Files:**
- Modify: `client/src/pages/Agenda.tsx` (estado, efecto scroll, matemática de grilla semana/día, header día)

- [ ] **Step 1: Agregar estado `hourHeight` persistido**

Agregar junto a los otros estados de vista (~línea 143, cerca de `currentDate`):
```ts
  const [hourHeight, setHourHeight] = useState<number>(() => {
    const saved = typeof localStorage !== 'undefined' ? Number(localStorage.getItem('agenda_hour_height')) : NaN;
    return ZOOM_LEVELS.includes(saved) ? saved : 68;
  });
  const zoomBy = (dir: 1 | -1) => {
    setHourHeight((cur) => {
      const i = ZOOM_LEVELS.indexOf(cur);
      const next = ZOOM_LEVELS[Math.min(ZOOM_LEVELS.length - 1, Math.max(0, (i < 0 ? ZOOM_LEVELS.indexOf(68) : i) + dir))];
      try { localStorage.setItem('agenda_hour_height', String(next)); } catch { /* noop */ }
      return next;
    });
  };
```

- [ ] **Step 2: Reemplazar todos los usos de `HOUR_HEIGHT` por `hourHeight`**

Buscar en el archivo cada uso de la constante `HOUR_HEIGHT` **dentro del componente** y reemplazar por la variable de estado `hourHeight`. Ubicaciones conocidas:
- `getEventLayout` (~594-595): `(startHrs - 7) * HOUR_HEIGHT` y `(endHrs - startHrs) * HOUR_HEIGHT` → `hourHeight`.
- `getRedTimeLinePosition` (~639): `(hrs - 7) * HOUR_HEIGHT` → `hourHeight`.
- Semana: `style={{ height: ... hours.length * HOUR_HEIGHT ... }}` (~1126), `top: hIdx * HOUR_HEIGHT` y `height: HOUR_HEIGHT` (~1135), bound check `hours.length * HOUR_HEIGHT` (~1199), click `Math.floor(clickY / HOUR_HEIGHT)` (~1167).
- Día: `height: hours.length * HOUR_HEIGHT` (~1233), `top: hIdx * HOUR_HEIGHT`, `height: HOUR_HEIGHT` (~1242), click `Math.floor(clickY / HOUR_HEIGHT)` (~1260).

**Importante:** NO borrar la constante de módulo `const HOUR_HEIGHT = 68;` todavía — sirve de fallback. Tras reemplazar todos los usos internos, eliminarla para evitar confusión (TypeScript marcará "declarado pero no usado" si queda sin uso → eliminarla).

- [ ] **Step 3: Actualizar el efecto de auto-scroll a las 8 AM**

Reemplazar (~líneas 176-181):
```ts
  useEffect(() => {
    if ((view === 'week' || view === 'day') && scrollContainerRef.current) {
      // 8 AM is index 1 from 7 AM, so 1 * 68 = 68px
      scrollContainerRef.current.scrollTop = 68;
    }
  }, [view]);
```
por:
```ts
  useEffect(() => {
    if ((view === 'week' || view === 'day') && scrollContainerRef.current) {
      // 8 AM is index 1 from 7 AM → un alto de hora.
      scrollContainerRef.current.scrollTop = hourHeight;
    }
  }, [view, hourHeight]);
```

- [ ] **Step 4: Agregar líneas de media hora en Semana y Día**

En la grilla de **Semana** (~líneas 1129-1150, dentro del `.map` de `hours`), agregar dentro del `<div>` de cada fila de hora, una línea dasheada a la mitad. Reemplazar el cierre del div de la fila para incluir la media hora. Cambiar:
```tsx
                  {hours.map((hour, hIdx) => (
                    <div
                      key={hour}
                      className={`absolute left-0 right-0 border-b flex ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.03]'
                      }`}
                      style={{ top: `${hIdx * hourHeight}px`, height: `${hourHeight}px` }}
                    >
```
por (agregar la línea de media hora como hijo absoluto):
```tsx
                  {hours.map((hour, hIdx) => (
                    <div
                      key={hour}
                      className={`absolute left-0 right-0 border-b flex ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.03]'
                      }`}
                      style={{ top: `${hIdx * hourHeight}px`, height: `${hourHeight}px` }}
                    >
                      <div className={`pointer-events-none absolute left-[12.5%] right-0 border-t border-dashed ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.02]'
                      }`} style={{ top: `${hourHeight / 2}px` }} />
```
(El resto del contenido de la fila —label de hora + columnas— queda igual debajo.)

En la grilla de **Día** (~líneas 1236-1252), hacer lo análogo. Cambiar el `<div>` de la fila para incluir:
```tsx
                      <div className={`pointer-events-none absolute left-20 right-0 border-t border-dashed ${
                        theme === 'light' ? 'border-slate-100' : 'border-white/[0.02]'
                      }`} style={{ top: `${hourHeight / 2}px` }} />
```
justo después de abrir el `<div>` de la fila de hora (antes del label de hora `w-20`).

- [ ] **Step 5: Agregar el control de zoom en el header de la vista Día**

En la vista Día, el encabezado del día está en ~líneas 1221-1229. Reemplazar:
```tsx
              {/* Day title */}
              <div className={`border-b py-3 flex-shrink-0 text-center select-none ${
                theme === 'light' ? 'border-slate-200 bg-slate-50' : 'border-white/5 bg-brand-dark/10'
              }`}>
                <span className={`text-xs font-bold uppercase tracking-widest block ${
                  theme === 'light' ? 'text-slate-400' : 'text-brand-secondary/80'
                }`}>{weekDaysNames[currentDate.getDay()]}</span>
                <span className={`text-2xl font-black mt-1 block ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>{currentDate.getDate()}</span>
              </div>
```
por:
```tsx
              {/* Day title + zoom control */}
              <div className={`border-b py-3 flex-shrink-0 relative text-center select-none ${
                theme === 'light' ? 'border-slate-200 bg-slate-50' : 'border-white/5 bg-brand-dark/10'
              }`}>
                <span className={`text-xs font-bold uppercase tracking-widest block ${
                  theme === 'light' ? 'text-slate-400' : 'text-brand-secondary/80'
                }`}>{weekDaysNames[currentDate.getDay()]}</span>
                <span className={`text-2xl font-black mt-1 block ${theme === 'light' ? 'text-slate-800' : 'text-white'}`}>{currentDate.getDate()}</span>
                <div className={`absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-1 border rounded-xl p-1 ${
                  theme === 'light' ? 'bg-white border-slate-200' : 'bg-white/5 border-white/10'
                }`}>
                  <button onClick={() => zoomBy(-1)} disabled={hourHeight === ZOOM_LEVELS[0]}
                    title="Alejar"
                    className={`p-1 rounded-lg transition disabled:opacity-30 ${theme === 'light' ? 'hover:bg-slate-100 text-slate-600' : 'hover:bg-white/10 text-brand-textMuted'}`}>
                    <Minus size={14} />
                  </button>
                  <span className={`text-[10px] font-mono font-bold w-7 text-center ${theme === 'light' ? 'text-slate-500' : 'text-brand-textMuted'}`}>
                    {Math.round((hourHeight / 68) * 100)}%
                  </span>
                  <button onClick={() => zoomBy(1)} disabled={hourHeight === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]}
                    title="Acercar"
                    className={`p-1 rounded-lg transition disabled:opacity-30 ${theme === 'light' ? 'hover:bg-slate-100 text-slate-600' : 'hover:bg-white/10 text-brand-textMuted'}`}>
                    <Plus size={14} />
                  </button>
                </div>
              </div>
```

- [ ] **Step 6: Agregar `Minus` al import de lucide-react**

En el import de `lucide-react` (líneas 13-17), agregar `Minus` (Plus ya está importado):
```ts
  FileText, Menu, Check, Filter, CalendarDays, Sun, Moon, Minus
```

- [ ] **Step 7: Verificar que compila**

Run: `cd client && npm run build`
Expected: compila sin errores. No quedan usos de `HOUR_HEIGHT` (constante eliminada).

- [ ] **Step 8: Commit**

```bash
git add client/src/pages/Agenda.tsx
git commit -m "feat(agenda): zoom de vista Día (+/-) con niveles + líneas de media hora"
```

---

## Task 6: Verificación funcional manual

**Files:** ninguno (verificación en navegador)

- [ ] **Step 1: Levantar el cliente**

Run: `cd client && npm run dev`
Abrir la URL que imprime Vite (típico `http://localhost:5173`), ir a la página **Agenda**.

- [ ] **Step 2: Verificar como ADMIN** (login con cuenta admin; si hay bypass de dev, asegurarse rol admin)

Checklist:
- [ ] La sidebar muestra la sección **"Agendas"** con un checkbox por profesional, cada uno con su cuadradito de color, + "Sin asignar".
- [ ] El `<select>` viejo de profesional **ya no está** en el header.
- [ ] Con todas marcadas: se ven todas las citas; cada cita toma el color de su profesional; las sin asignar salen en gris.
- [ ] Desmarcar un par de profesionales → desaparecen sus citas. El botón alterna "Todas"/"Ninguna".
- [ ] Dejar una sola marcada → solo esa agenda (equivale al filtro viejo).
- [ ] Cada cita muestra el **badge de estado** (✓ confirmada, reloj pendiente, ✕ cancelada, etc.) en semana y día; en mes el estado se ve en el `title` (hover).
- [ ] Los checkboxes de **"Mis Calendarios"** (estado) siguen filtrando por estado y se combinan con la selección de agendas.

- [ ] **Step 3: Verificar el ZOOM en vista Día**

- [ ] Ir a vista **Día** con un día que tenga varias citas cercanas.
- [ ] Botón **+** agranda las filas → las citas amontonadas se separan y quedan legibles. **−** las achica. El % se actualiza.
- [ ] Se ven **líneas dasheadas de media hora**.
- [ ] La **línea roja "ahora"** y el auto-scroll inicial siguen alineados al cambiar el zoom.
- [ ] Recargar la página (F5) → el nivel de zoom **persiste** (localStorage).

- [ ] **Step 4: Verificar como EMPLEADA** (login con cuenta no-admin)

- [ ] La sección **"Agendas"** NO aparece.
- [ ] Solo se ven las citas de la propia empleada (su `user.id`); no puede ver otras agendas.
- [ ] El zoom de vista Día funciona igual.

- [ ] **Step 5: Commit final (si hubo ajustes durante la verificación)**

```bash
git add -A
git commit -m "fix(agenda): ajustes de verificación manual multi-agenda + zoom"
```
(Si no hubo cambios, omitir.)

---

## Notas de implementación

- **Build gate:** `cd client && npm run build` corre `tsc -b && vite build`. Es el chequeo automatizado de cada tarea. Si `tsc` falla por variables sin usar entre tareas intermedias, está documentado en cada tarea cómo resolverlo (las Tareas 2 y 3 se compilan/commitean juntas por la dependencia del `<select>`).
- **Sin backend:** ninguna ruta de `server/` cambia. El filtrado es client-side sobre `appointments` ya cargadas.
- **Orden de líneas:** los números de línea son aproximados (`~`) porque cada tarea desplaza el archivo. Ubicar por el contexto del código citado, no por el número exacto.

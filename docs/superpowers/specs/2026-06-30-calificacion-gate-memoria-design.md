# Diseño — Gate de calificación área-aware + memoria de calificación

> Fecha: 2026-06-30 · Rama: `feat-omnichannel`
> Origen: dos conversaciones reales donde el agente agendó cita gratis sin calificar
> (jubilación mujer 61 años; jubilación mujer Mendoza). El agente saltea TODO el
> procedimiento de calificación del libreto.

## Problema

El gate determinístico `bookingIntent` (`AgentRuntime.ts:104-111`) arranca el
`BookingFlow` apenas detecta `reservar|cita|turno|agendar` (`BookingFlow.ts:56`),
**antes** de llamar al LLM. Resultado: el libreto del estudio (que exige calificar
edad/hijos/aportes y decidir consulta gratis vs análisis pago $29.000) **nunca corre**.
100% reproducible: ambas conversaciones abren con "reservar una cita por Jubilación
de mujer" → regex matchea → booking inmediato → cero calificación.

Contradice el propio libreto (recepción, punto 3): *"Pedir una cita NUNCA salta el
procedimiento del área correspondiente."*

**Daño:** se regalan citas gratis a leads no calificados que deberían ser análisis
previsional pago.

## Decisiones (brainstorming)

1. **Gate área-aware**: el gate sigue arrancando booking para pedidos SIN área
   ("quiero un turno"), pero NO dispara si el mensaje menciona un área que requiere
   calificación. Ahí manda el LLM/libreto. (No se agrega guard duro en `start_booking`.)
2. **Detección de área por regex de keywords** (determinístico, mismo estilo que el código actual).
3. **Memoria completa**: calificación estructurada persistida + reuso al volver (migración).
4. **Registro vía tool dedicada** `set_qualification` que llama el LLM.
5. **Vigencia: TTL configurable, default 30 días.** Más nuevo que el TTL → reusar; vencido → recalificar.
6. **Bloque de reuso va en la FICHA.** `calificacion` como **mapa por área**.

## Componentes

### A. AreaDetector (nuevo) — `server/src/core/agent/context/AreaDetector.ts`

```ts
export type AreaKey =
  | 'jubilacion_hombre' | 'jubilacion_mujer' | 'jubilacion'
  | 'pension_viudez' | 'laboral' | 'art' | 'transito';

export function detectArea(text: string): AreaKey | null;
```

- Regex de keywords por área (normaliza acentos/case como `norm()` de BookingFlow).
  - `jubilacion_mujer`: "jubilación de mujer", "jubilarme" + género femenino explícito, etc.
  - `jubilacion_hombre`: "jubilación de hombre", etc.
  - `jubilacion`: "jubilación"/"jubilarme" sin género.
  - `pension_viudez`: "pensión", "viudez", "falleció mi …".
  - `laboral`: "despido", "me echaron", "laboral", "indemnización".
  - `art`: "ART", "accidente laboral", "accidente de trabajo".
  - `transito`: "accidente de tránsito", "me chocaron", "choque".
- Si ninguna matchea → `null`.
- **Todas** las áreas requieren calificación (no hay tabla aparte; detectar área = requiere calificar).
- Orden de prioridad: género explícito antes que `jubilacion` genérico; `transito`/`art` antes que `laboral` si hay solapamiento de palabras.

### B. Gate área-aware — `AgentRuntime.ts:104-111`

Lógica nueva en el bloque `else if (this.deps.booking && this.deps.bookingIntent)`:

```
const intent = bookingIntent(text);
if (intent.start) {
  const area = detectArea(text);            // nueva dep inyectada
  if (area) {
    // Área con calificación → NO arrancamos booking determinístico.
    // Dejamos que el LLM/libreto califique (y luego llame start_booking).
  } else {
    // Booking pelado, sin área → gate dispara como hoy.
    const r = await booking.start(...);
    if (r.messages.length) return finishWith(r.messages);
  }
}
```

- El reuso (contacto ya calificado) NO lo maneja el gate: lo maneja el LLM al ver la
  calificación previa inyectada en la ficha. Así el branching gratis/pago/descartar
  queda donde corresponde (libreto), no en el flujo de logística.
- `detectArea` se inyecta como dep (`areaDetector?: (text) => AreaKey | null`) para test;
  cableado en `createAgentRuntime`.

### C. Tool `set_qualification` (nuevo) — `ToolRegistry.ts`

Schema:
```
name: 'set_qualification'
description: 'Registrá el resultado de la calificación del área (jubilación, etc.)
  cuando terminaste las preguntas del procedimiento, ANTES de ofrecer agendar.'
parameters:
  area: enum(AreaKey)            (requerido)
  resultado: enum('gratis','pago','descartar')   (requerido)
  edad?: number
  hijos?: number
  aportes_aprox?: number
  notas?: string
```

Handler (`execute('set_qualification', args, ctx)`):
- Persiste vía `ContactMemory.setCalificacion(accountId, phone, area, { resultado, datos, calificado_at })`.
- Devuelve `{ ok: true }`.

Refuerzo **soft** (sin bloqueo runtime):
- `AgentPersona.ts`: regla nueva → "Cuando termines la calificación de un área, llamá
  `set_qualification` con el resultado antes de ofrecer agendar."
- Descripción de `start_booking`: recordatorio "solo tras calificar/registrar".

### D. Memoria estructurada — migración `0030_calificacion.sql`

```sql
ALTER TABLE contact_memory ADD COLUMN IF NOT EXISTS calificacion jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS calificacion_ttl_days integer DEFAULT 30;
```

Forma de `contact_memory.calificacion` (mapa por área):
```json
{
  "jubilacion_mujer": {
    "resultado": "gratis",
    "datos": { "edad": 61, "hijos": 2, "aportes_aprox": 22 },
    "calificado_at": "2026-06-30T05:00:00.000Z"
  }
}
```

`ContactMemory`:
- `setCalificacion(accountId, phone, area, entry)`: lee mapa actual, mergea la clave del
  área (pisa la previa de esa área), upsert. Tolerante a columna ausente (try/catch, como `loadLoopGuardState`).
- `load()`/`loadExtended()`: incluir `calificacion` en el select (tolerante a esquema viejo).

### E. Reuso al volver (TTL) — bloque en la ficha

La ficha se compone hoy en `ContactMemory.load` → `fichaText` (`buildFichaText`). El bloque
de calificación va ahí. El TTL es por-cuenta, así que el seam es:

- Firma nueva: `memory.load(accountId, phone, opts?: { ttlDays?: number; area?: AreaKey | null })`
  (default `ttlDays = 30`).
- `AgentRuntime.handle` pasa `account.calificacion_ttl_days` y `detectArea(text)` al `memory.load`.
- `buildFichaText` recibe el `calificacion` + `ttlDays` + `area` + `now` y agrega el fragmento
  (helper interno `buildCalificacionFicha`).
- Render (solo entradas con `now - calificado_at <= ttlDays*86400000`):
  > `CALIFICACIÓN PREVIA (Jubilación Mujer, hace 5 días): VIABLE consulta gratis. Edad 61, 2 hijos, ~22 años aportes. No re-preguntes lo ya sabido; ofrecé agendar.`
- Vencidas → no se renderizan (el agente recalifica). (Opcional, fuera de alcance:
  nota "calificó hace X, vencida".)
- Si el mensaje actual trae área (`detectArea`), priorizar esa área en el render; si no,
  renderizar todas las frescas.

## Archivos

| Archivo | Cambio |
|---|---|
| `context/AreaDetector.ts` | **nuevo** |
| `runtime/AgentRuntime.ts` | gate área-aware + dep `areaDetector` + pasar `ttlDays` a `memory.load` |
| `runtime/ToolRegistry.ts` | tool `set_qualification` (schema + execute) |
| `runtime/AgentPersona.ts` | regla soft set_qualification + nota en start_booking |
| `context/ContactMemory.ts` | `setCalificacion`, leer `calificacion`, ficha con TTL |
| `runtime/createAgentRuntime.ts` | cablear `areaDetector` |
| `supabase/migrations/0030_calificacion.sql` | **nuevo** (2 columnas) |

## Plan TDD (orden)

1. **AreaDetector** — keywords por área, paráfrasis, prioridad género, `null` en booking pelado.
2. **Gate runtime** — *reproduce el bug*: mensaje con área + no calificado → `bookingIntent`
   NO dispara, toma camino LLM. Booking pelado → dispara. Contacto calificado-fresco con
   área → sigue sin disparar gate (lo agenda el LLM).
3. **set_qualification** — persiste objeto estructurado por área + stamp `calificado_at`.
4. **Memoria reuso** — entrada fresca (<TTL) se inyecta en la ficha; vencida se ignora;
   mapa por área respeta área del mensaje.

## Fuera de alcance (otros bugs detectados, no este spec)

- #2 `outOfCoverage` agenda presencial para otra provincia (debería forzar video).
- #3 dirección basura `CABA123` (dato de oficina).
- #4 recordatorio inmediato / "de hoy" (`ReminderScheduler` + dato/TZ).
- #5 truncado de primeros chars en la capa de envío WhatsApp.

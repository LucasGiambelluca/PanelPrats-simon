# Extractor de prospección — diseño

> Fecha: 2026-07-06 · Rama: feat-omnichannel
> Rol del organigrama que mejora: **Clasificador** (spec agenda proactiva §2). Priorizado por el usuario por delante de la agenda proactiva.

## 1. Problema

La persona manda UN mensaje inicial con casi todos los datos ("soy Ana, tengo 63 años, 30 de aportes, vivo en Quilmes, quiero jubilarme") y el agente igual pregunta uno por uno lo que ya le dijeron → conversación incoherente, loops (124 conversaciones con mensaje repetido 3+), calificación en 5-6 turnos.

**Causa raíz (verificada en código):** la extracción existe pero nadie la consume.

1. `IntentClassifier` extrae `slots_detectados` por turno → `mergeSlots` los guarda en `dialogue_state.slots`… y ahí mueren:
   - El system prompt del tool-loop **no incluye los slots** (`AgentRuntime` arma ficha + continuidad + calificación, nunca los slots del diálogo).
   - El gate determinístico de agendado llama `booking.start` pasando **solo modalidad** (`AgentRuntime.ts:171`) aunque `dialogue_state` tenga nombre y zona.
2. `BookingFlow.startBooking` **ya sabe saltear etapas** si recibe modalidad/zona/nombre — el hueco es que no se los pasan.
3. La extracción del clasificador es superficial: claves "sugeridas" sin normalización ni saneo.
4. Hay 4 extractores parciales desconectados que corren tarde: clasificador (por turno), `ReceptionFichaBuilder` (al agendar), `MemoryUpdater` (post-turno), `AppointmentAuditor` (post-cita).

## 2. Diseño — tres piezas

Patrón invariante del sistema: **LLM enjaulado** (convierte texto libre en JSON cerrado, temp 0), **código sanea y decide**.

### P1. `ProspectExtractor` (nuevo — `core/agent/context/ProspectExtractor.ts`)

**Cuándo corre** (código decide, no el LLM):
- Primer mensaje del contacto (sin historial previo), o
- Mensaje entrante ≥ 120 caracteres.
- Nunca en mensajes cortos posteriores: esos ya los cubre el clasificador de cada turno.
- Tope: máx 1 pasada profunda por conversación por día (control de costo). Marca `extractor_last_at` dentro de `dialogue_state` (jsonb existente, sin migración).

**Ejecución:** en paralelo con el clasificador (`Promise.all` dentro de `ConversationController.handleTurn`, antes de decidir) → **cero latencia agregada** (el turno ya espera al clasificador).

**Entrada:** texto del mensaje + últimos mensajes como contexto.

**Proceso:** LLM temp 0, salida JSON cerrada:

```json
{
  "nombre": null, "edad": null, "genero": "m|f|null",
  "anios_aporte": null, "localidad": null, "telefono": null,
  "modalidad": "presencial|video|null", "area_texto": null,
  "hijos": null, "urgencia": "alta|normal|null", "mejor_horario": null
}
```

**Saneadores server-side — nada del modelo pasa crudo:**
- `telefono` → `validarTelefonoAR` (inválido = descartado, no guardado).
- `localidad` → `matchZone` contra el gazetteer (sin match = se guarda como texto pero no rutea sede).
- `edad` 18-110, `anios_aporte` 0-60 (fuera de rango = descartado).
- `genero`/`modalidad`/`urgencia` → enum cerrado o null.
- **Área: `AreaDetector` (regex) tiene prioridad**; `area_texto` del modelo solo se usa si el regex no detectó nada, y se re-valida pasándolo por `detectArea`.

**Reglas duras** (patrón `IntentClassifier`): nunca lanza excepción; timeout / no-JSON / proveedor caído → `{}` y la conversación sigue igual que hoy. El extractor es best-effort: su ausencia nunca degrada el flujo actual.

**Salida:** merge a `dialogue_state.slots` vía `mergeSlots` existente (nunca pisa valor lleno con vacío) + setea `area` si estaba vacía.

### P2. Consumo — el fix de coherencia (la parte que mata la re-pregunta)

Esto vale para TODOS los slots llenos, vengan del extractor o del clasificador turno a turno:

- **a) Bloque al system prompt.** Nueva función pura `buildDatosAportados(slots)` → bloque "DATOS YA APORTADOS POR EL CLIENTE (no los vuelvas a preguntar; usalos)" con los slots llenos. `AgentRuntime` lo suma a la ficha, junto a continuidad y calificación previa.
- **b) Gate determinístico completo.** `AgentRuntime` (hoy `:171`) pasa a `booking.start` también `nombre` y `zona` desde `dialogue_state.slots` (además de la modalidad del intent). `BookingFlow` ya saltea `ask_modality`/`ask_zone`/`ask_name` cuando los recibe — sin cambios ahí.
- **c) `start_booking` del LLM.** El executor de la tool completa args vacíos con los slots del diálogo (el modelo a veces no repite lo que ya sabe).
- **d) Teléfono.** Si hay `telefono` saneado en slots y el canal lo requiere (FB/IG), `BookingFlow` confirma en vez de pedir de cero ("¿le agendamos al 11-5174-...?").
- **e) Calificación.** `edad`/`anios_aporte` visibles en el prompt vía (a) → el libreto salta esas preguntas y llama `set_qualification` antes. Sin cambios en `QualificationRules`.

### P3. Clasificador reforzado (menor)

Claves de `slots_detectados` normalizadas al MISMO esquema de P1 (hoy "sugeridas": el modelo inventa variantes). Lista cerrada en el prompt + descarte de claves desconocidas en el sanitizador.

## 3. Qué NO cambia

- `ConversationController` fases 0-8: intactas (el extractor solo llena slots antes).
- `BookingFlow`: sin cambios estructurales (ya soporta arranque con datos que saltea etapas). Única extensión: P2(d), en `ask_phone` confirmar un teléfono ya saneado en vez de pedirlo de cero.
- Sin migración de DB: `dialogue_state` (jsonb, 0031) ya guarda slots.
- Sin flag por cuenta: es pipeline de entrada best-effort, riesgo bajo, activo siempre. (Si el costo preocupa: el tope 1/día ya lo limita.)

## 4. Manejo de errores

| Falla | Comportamiento |
|---|---|
| Extractor timeout / no-JSON / API caída | `{}` — el turno sigue como hoy (solo clasificador) |
| Dato fuera de rango o teléfono inválido | Se descarta ese campo, se guardan los demás |
| Slot ya lleno por respuesta directa del cliente | `mergeSlots` actualiza con el valor nuevo (el más reciente gana) |
| Extractor y clasificador devuelven el mismo slot distinto | Gana el clasificador (es específico del turno; el extractor es pasada amplia) |

## 5. Testing

- Unit `ProspectExtractor`: saneadores (teléfono, rangos, enums, prioridad de AreaDetector), fallback `{}`, tope 1/día — sin red, IA mockeada.
- Unit `buildDatosAportados`: bloque correcto, vacío si no hay slots.
- `ConversationController` con extractor mockeado: mensaje rico → slots llenos → `nextPendingSlot` null → no pregunta.
- `AgentRuntime`: gate pasa nombre/zona; tool `start_booking` completa args.
- Regresión: `BookingFlow` arranca con datos → saltea etapas (tests existentes cubren, agregar caso combinado).
- Simulación end-to-end con `sim-agent.ts`: mensaje inicial rico ("soy Ana, 63 años, 30 de aportes, Quilmes, quiero jubilarme") → esperado: 0 re-preguntas de nombre/edad/zona, calificación en ≤2 turnos.

## 6. Medición de éxito

Re-correr `analyze-conversaciones.js` a las 2 semanas del deploy:
- `loop_mensaje_repetido` (hoy 124) y `eco_consecutivo` (185) en baja.
- Turnos promedio hasta `set_qualification` en conversaciones con mensaje inicial ≥120 chars.
- `booking_truncado` en baja (menos fricción = menos abandono a mitad de agendado).

## 7. Fuera de alcance

- UI de ficha de prospección en el panel (v1.1 — los datos ya quedan en `dialogue_state`, la UI es solo lectura después).
- Extracción de imágenes/audios/documentos.
- Reprocesar conversaciones históricas.
- Libreto por rol/área (proyecto aparte, sigue en el mapa).

## 8. Decisiones registradas

- Extractor como **pasada dedicada solo en mensajes ricos** + clasificador reforzado para el resto — no una llamada extra en cada turno (costo) ni solo-clasificador (pierde el caso del mensaje largo, que es justo el que falla).
- Corre **en paralelo** al clasificador → sin latencia agregada.
- Prioridad de fuentes: respuesta directa del turno (clasificador) > extractor > lo ya guardado si lo nuevo viene vacío.
- Sin LLM con acceso directo a la DB: el extractor devuelve JSON, el código escribe.

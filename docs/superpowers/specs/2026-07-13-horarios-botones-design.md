# Diseño — Horarios disponibles como botones (agente vivo)

Fecha: 2026-07-13
Branch: feat-omnichannel

## Problema

El agente vivo (`AgentRuntime`) ofrece los horarios como **texto**
("tengo disponible por videollamada de mañana a las 09:15, sobre el mediodía a
las 12:45 o de tarde a las 14:15"). El cliente responde en texto libre ("10 y 30
puede ser") y `OptionResolver` no siempre lo caza → el agente contesta
"Disculpe, no le entendí el horario" y entra en loop. Verificado en logs de prod
(últimas 24 h).

El estudio pide enviar los horarios como **botones** para: (1) evitar que el
cliente "nos diga" en texto libre y (2) eliminar los errores de resolución.

## Objetivo (scope acotado)

Solo el **agendado inicial**: cuando el agente propone slots, mandarlos como
reply-buttons interactivos en WhatsApp Oficial. NO incluye (por ahora):
reprogramación, confirmación Sí/No, ni elección de modalidad/sede.

## Restricciones que fijan el diseño

- WhatsApp Cloud API: reply-buttons **máximo 3**; título de botón **≤20 chars**.
- `proposeCascade` ofrece **máximo 3 slots** → encaja exacto en 3 botones.
- Solo **WhatsApp Oficial** soporta botones de forma confiable. FB/IG (baileys)
  tiene botones deprecados/rotos → esos canales mantienen el texto actual.

## Estado actual del código (puntos de anclaje)

- `BookingFlow.ts:389` — `loadSlots` arma `offered: OfferedOption[]`
  (`{index, label, value: s.start}`) + `showSlotsMessage(...)` (string) y
  devuelve `{ state, messages: string[], active }`.
- `AgentRuntime.run` — devuelve `string[]` puro (`finishWith`). **No hay canal
  para un payload interactivo por esta ruta.**
- `WhatsAppOfficialClient.sendResponse:217` — **YA** soporta la rama
  `response.interactive` → `sendInteractive` (buttons ≤3 / lista ≤10).
- `WhatsAppOfficialClient.parseIncoming:199-205` — **YA** decodifica
  `button_reply.id` / `list_reply.id` → `routingText`.
- `OptionResolver.resolveOption:139` — resuelve texto libre; un índice pelado
  (`^\d+$`) matchea por posición (`:35`, `:145`).

## Diseño

### 1. Ensanchar el tipo de respuesta del agente (plumbing)

Nuevo tipo compartido:

```ts
type WaInteractive = {
  type: 'button';
  body: { text: string };
  action: { buttons: Array<{ type: 'reply'; reply: { id: string; title: string } }> };
};
type AgentReply = string | { text: string; interactive: WaInteractive };
```

Threading (widen `string[]` → `AgentReply[]`):
- `BookingStep.messages: AgentReply[]`
- `BookingDeps.advance/start/startReschedule` return `{ messages: AgentReply[]; active }`
- `AgentRuntime.run` return `AgentReply[]` (`finishWith` acepta `AgentReply[]`)
- `onMessage` (binding cuenta→cliente) propaga `AgentReply[]` sin aplanar
- `WhatsAppOfficialClient.sendResponse` — sin cambio; ya distingue objeto
  interactivo de string.

Cualquier canal que NO sea WA oficial recibe la rama string (ver §4), así el
resto del sistema no cambia de comportamiento.

### 2. Construcción de los botones

Nuevo helper en `BookingFlow.ts`:

```ts
function buildSlotsInteractive(bodyText: string, offered: OfferedOption[]): WaInteractive
```

- `body.text` = el mismo texto de hoy (`showSlotsMessage`), sin los ejemplos de
  hora si se quiere, pero manteniendo "¿Cuál le queda más cómodo? …o escribime
  otro día/horario".
- Un botón por slot (máx 3):
  - `id` = `slot:<ISO>` (token dedicado, ej `slot:2026-07-13T14:15:00.000Z`),
    usando `offered[i].value` (que ya es `s.start`).
  - `title` = label corto **≤20 chars**, formato `Lun 13/07 09:15`
    (día abreviado + fecha + hora AR). Helper `shortSlotTitle(iso)`.
- `loadSlots` decide: si el canal es WA oficial → devolver
  `{ text, interactive }`; si no → el string plano de hoy.

### 3. Vuelta del tap → resolución determinística

- Cliente toca botón → Meta manda `interactive.button_reply.id = "slot:<ISO>"`.
- `parseIncoming` mete ese id en `routingText` (ya funciona).
- **Nueva rama al inicio de `resolveOption`**: si `userText` matchea
  `^slot:(.+)$`, buscar match **exacto** contra `offered[].value` (el ISO):
  - hit → `OptionMatch` con confianza máxima, `value` = ese ISO.
  - miss (ISO no está en las opciones ofrecidas, ej. sesión vieja) → sin match,
    cae al flujo normal (no crashea).
- No pasa por el parser de horas → elimina el "no le entendí el horario".

### 4. Fallback por canal

- `loadSlots`/`buildSlotsInteractive` reciben una señal de si el canal soporta
  interactive. Fuente: provider/capacidad de la cuenta (misma info que ya usa
  `AccountManager`; p. ej. `supportsInteractive` derivado de provider ===
  WhatsApp oficial).
- Solo WA oficial → botones. FB/IG/otros → string plano actual (intacto).
- Si por cualquier motivo no se puede armar el interactive (0 slots, etc.) →
  string plano.

### 5. Testing

- `BookingFlow.videoCascade` / loadSlots:
  - cuenta WA oficial → `messages[0]` es `{interactive}` con ≤3 buttons, ids
    `slot:*`, títulos ≤20 chars, orden = orden de `offered`.
  - cuenta FB → `messages[0]` es string (comportamiento actual).
  - 0 slots → string ("No hay horarios…"), nunca interactive vacío.
- `OptionResolver.resolveOption`:
  - input `slot:<ISO>` presente en offered → match exacto por value.
  - input `slot:<ISO>` ausente → sin match, sin excepción.
  - texto libre sigue resolviendo como hoy (no regresión).
- `WhatsAppOfficialClient.parseIncoming`:
  - `button_reply` con id `slot:*` → routingText = ese id.
- End-to-end (BookingFlow.advance): estado `await_slot` + input `slot:<ISO>` →
  agenda en el slot/oficina/profileId correcto (usa `meta[value]`).

## Fuera de scope (posible follow-up)

- Botones en reprogramación.
- Confirmación Sí/No como botones.
- Modalidad/sede como botones.
- Bug aparte reportado: reasignar profesional en el panel "da pantalla en
  blanco" (probable crash de React en `Agenda.tsx:363`, `loadAppointments(true)`
  fuera del try/catch). NO es parte de este spec.

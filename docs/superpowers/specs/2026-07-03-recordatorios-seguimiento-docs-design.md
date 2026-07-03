# Recordatorios 24hs + seguimiento post-reunión + documentación — Diseño

**Fecha:** 2026-07-03
**Branch:** feat-omnichannel
**Estado:** aprobado el enfoque (templates), pendiente review del spec

## Problema

Auditoría del agente vs 6 capacidades pedidas dejó 3 gaps:

- **#4 Reminder 24hs + reprogramación** — la reprogramación ya funciona (`BookingFlow`). El recordatorio existe (`ReminderScheduler`) pero dispara ~20 min antes (default `reminder_minutes=20`), no 24hs antes.
- **#5 Seguimiento post-reunión 24hs** — no existe. Ningún job dispara mensaje después de la cita.
- **#6 Registro y seguimiento de documentación** — hay registro manual (campos libres `faltante`/`carpeta`/`seguimiento`/`resultado=traer_doc` en `appointments`), pero no hay checklist por documento ni chase automático.

## Restricción central: ventana de 24hs de WhatsApp → templates

Los 3 features son mensajes **proactivos** que casi siempre caen **fuera de la ventana de 24hs** de WhatsApp (el cliente reservó/asistió hace días y no escribió). WhatsApp solo permite mensaje libre dentro de 24hs del último inbound del cliente; fuera de eso exige **templates aprobados por Meta (HSM)**.

Hoy el sistema **no soporta templates**: `WhatsAppOfficialClient` (Cloud API, `server/src/infrastructure/meta/WhatsAppOfficialClient.ts:41`) solo manda `type:'text'` y `sendInteractive`, ambos ligados a la ventana. El `ReminderScheduler` (`server/src/services/ReminderScheduler.ts:85`) directamente **salta** las citas fuera de ventana. Por eso: **la base de todo es agregar soporte de templates.** El usuario da de alta los templates en Meta Business (categoría UTILITY); acá se construye el `sendTemplate` + el ruteo.

## Contexto del código

- Envío Cloud API: `WhatsAppOfficialClient.sendMessage` (`WhatsAppOfficialClient.ts:41`) → `POST {GRAPH_BASE}/{phone_number_id}/messages`, Bearer `accessToken`. Config: `{ phone_number_id, accessToken, waba_id }` (`:12-16`). `GRAPH_VERSION='v21.0'`.
- Ruteo: `AccountManager.sendMessage` (`server/src/core/accounts/AccountManager.ts:116`) → si el client es `MetaClient`/`WhatsAppOfficialClient` usa `client.sendMessage(to,text)`; si es Baileys usa `sendFormattedMessage`. Prod = Cloud API oficial.
- Scheduler existente: `ReminderScheduler` (`ReminderScheduler.ts`), tick 60s, instanciado en `server/src/index.ts:59,98`. Marca `no_asistio` al cierre del día (`:110-121`). Idempotente vía flag `reminded`.
- Estados de cita (`supabase/migrations/0007_appointment_status_lifecycle.sql:5`): `pendiente | confirmada | cancelada | asistio | no_asistio | cerrado`.
- Ficha de cita: `AppointmentService` (`server/src/services/AppointmentService.ts`), rutas CRUD `server/src/api/routes/appointments.routes.ts`. Campos de docs actuales: `faltante`, `carpeta`, `seguimiento`, `resultado` (incluye `traer_doc`).
- Última migración: `0035_contactos_llamados.sql`.

## Diseño

### Componente base — capa de templates

**`WhatsAppOfficialClient.sendTemplate(to, name, lang, components)`** (nuevo método, mismo patrón que `sendMessage`): `POST .../messages` con
```json
{ "messaging_product":"whatsapp", "to":"<phone>", "type":"template",
  "template": { "name":"<name>", "language": { "code":"<lang>" }, "components":[...] } }
```
Registra OUTBOUND en el `store` (igual que `sendMessage`). `MetaClient` recibe el mismo método si comparte la ruta (verificar en implementación; si `MetaClient` extiende/comparte, reusar).

**`AccountManager.sendTemplate(accountId, to, name, lang, components)`** (nuevo): si el client es `WhatsAppOfficialClient`/`MetaClient` → `client.sendTemplate(...)`. Si es Baileys → best-effort: renderiza los params al texto y usa `sendMessage` (Baileys no tiene HSM). Prod es oficial, así que la ruta real es la de template.

**Registro de templates** — módulo `server/src/services/whatsappTemplates.ts`: mapa de clave lógica → `{ metaName, lang, build(params) → components }`. Las claves lógicas las usa el scheduler; los `metaName`/`lang` deben coincidir con lo aprobado en Meta. Sin UI ni DB (YAGNI); son constantes. Cada `build` arma el array `components` (body con `parameters` de tipo text, en orden).

**Templates a dar de alta en Meta (categoría UTILITY, idioma `es_AR` o `es`):**

| clave lógica | metaName sugerido | cuerpo (con variables) | params |
|---|---|---|---|
| `reminder_24h` | `recordatorio_cita_24h` | "Hola {{1}}, te recordamos tu cita en el estudio para el {{2}} a las {{3}} hs ({{4}}). Si necesitás reprogramar, respondé este mensaje." | nombre, fecha, hora, sede/modalidad |
| `seguimiento` | `seguimiento_post_cita` | "Hola {{1}}, gracias por tu visita. Quedamos a disposición por cualquier consulta sobre tu trámite. Si querés avanzar, respondé este mensaje." | nombre |
| `reagendar` | `reagendar_no_asistio` | "Hola {{1}}, no pudimos verte en tu cita del {{2}}. ¿Reprogramamos? Respondé este mensaje y coordinamos un nuevo turno." | nombre, fecha |
| `docs_pendientes` | `documentacion_pendiente` | "Hola {{1}}, para avanzar con tu trámite necesitamos: {{2}}. Podés acercarla al estudio o enviarla por este chat." | nombre, lista de docs |

Nota: si el cliente respondió al template (entra a la ventana de 24hs), el agente normal retoma la conversación por el flujo existente (webhook → AgentRuntime). Los templates solo abren la puerta.

### Feature #4 — Reminder 24hs

El recordatorio corto del día (≈20 min, `ReminderScheduler`) **queda como está** (ya funciona in-window). Se agrega el **recordatorio 24hs antes** como evento nuevo del scheduler de proactivos (abajo), enviado por template `reminder_24h`. Flag idempotente `reminder_24h_sent` en `appointments`. Dispara cuando faltan ~24hs (ventana ±30 min alrededor de T-24h) y la cita no está `cancelada`.

### Feature #5 — Seguimiento post-reunión 24hs

Evento a **T+24hs** (start_time + 24hs), idempotente vía flag `followup_sent`, ruteado por estado de la cita:
- `no_asistio` → template `reagendar`.
- `cancelada` → no se envía.
- resto (`asistio`, `confirmada`, `pendiente`, `cerrado`) → si la cita **tiene docs pendientes** (ver #6) → template `docs_pendientes` (arranca el chase y evita doble mensaje); si **no** tiene docs pendientes → template `seguimiento`.

Así el follow-up y el pedido de docs no se pisan: un solo mensaje a T+24h según el caso.

### Feature #6 — Checklist de documentación + chase

**Modelo — tabla nueva `appointment_docs`** (migración `0036`):
```sql
CREATE TABLE IF NOT EXISTS appointment_docs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  account_id     text NOT NULL,
  documento      text NOT NULL,                 -- ej "DNI", "Recibos de sueldo", "Clave ANSES"
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','entregado')),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointment_docs_appt ON appointment_docs(appointment_id);
```
El campo libre `faltante` se conserva (no se borra) pero la UI nueva trabaja sobre `appointment_docs`. Recepción arma el checklist a mano en la ficha de la cita (pre-carga por área = fast-follow, fuera de v1).

**Chase automático** — evento del scheduler: para citas con ≥1 doc `pendiente`, si pasó la cadencia (default **3 días** desde el último chase) y no se superó el máximo (default **3 intentos**), envía template `docs_pendientes` con la lista de docs pendientes. Contadores en `appointments`: `doc_chase_count int default 0`, `doc_chase_last_at timestamptz`. Se detiene cuando no quedan docs pendientes o se alcanza el máximo.

**Entregado** — recepción marca cada doc `entregado` a mano en el panel (setea `delivered_at`). No se detecta la entrega por media entrante (fuera de alcance).

**UI** — en la ficha de la cita (dashboard): sección "Documentación" con lista de ítems (agregar/quitar, marcar entregado), y un badge de "N docs pendientes". Rutas nuevas bajo `appointments.routes.ts` o un router `appointment-docs.routes.ts`.

### Scheduler de proactivos

**`AppointmentFollowupScheduler`** (nuevo, `server/src/services/AppointmentFollowupScheduler.ts`) — tick 60s sobre una ventana de citas (reusa `AppointmentService.listSchedulerWindow` ampliando la ventana para cubrir T+24h y el chase, o un método nuevo). Para cada cita computa qué eventos están **vencidos y no enviados** y los dispara por template. Convive con `ReminderScheduler` (que sigue con el corto del día + no_asistio); separar mantiene el path que ya anda intacto y da una responsabilidad por archivo.

**Decisión pura y testeable:** extraer `dueAppointmentEvents(appt, docsPendientes, now, cfg) → Event[]` (Event ∈ `reminder_24h | followup | doc_chase`), sin DB/red/reloj. El scheduler solo hace I/O: trae datos, llama la función pura, y por cada evento manda el template y persiste el flag/contador. Esto permite testear toda la lógica de disparo sin mocks de red.

Config (constantes v1, con defaults): `REMINDER_24H_ENABLED=true`, `FOLLOWUP_ENABLED=true`, `DOC_CHASE_ENABLED=true`, `DOC_CHASE_EVERY_DAYS=3`, `DOC_CHASE_MAX=3`, `T24H_TOLERANCE_MIN=30`.

Instanciar y arrancar en `server/src/index.ts` junto a los otros schedulers (crear + `.start()` + `.stop()` en el shutdown).

## Migraciones

- `0036_appointment_docs.sql` — tabla `appointment_docs` (arriba).
- `0037_appointment_followup_flags.sql` — en `appointments`: `reminder_24h_sent boolean DEFAULT false`, `followup_sent boolean DEFAULT false`, `doc_chase_count int DEFAULT 0`, `doc_chase_last_at timestamptz`.

## Decomposición y orden de build (planes separados)

1. **Plan A — Capa de templates:** `sendTemplate` en `WhatsAppOfficialClient` (+ `MetaClient` si aplica), `AccountManager.sendTemplate`, `whatsappTemplates.ts` con los 4 templates. Tests de payload + builders. Es la base.
2. **Plan B — Scheduler + reminder 24hs + post-reunión:** migración `0037`, `AppointmentFollowupScheduler` con la función pura `dueAppointmentEvents`, eventos `reminder_24h` y `followup`, wiring en `index.ts`. Tests de la función pura.
3. **Plan C — Docs checklist + chase:** migración `0036`, modelo/rutas `appointment_docs`, UI en la ficha, evento `doc_chase` en el scheduler. Tests.

## Fuera de alcance (v1)

- Detección automática de entrega de docs por media entrante (recepción marca a mano).
- UI/DB de administración de templates (son constantes en código).
- Pre-carga de checklist de docs por área (recepción los carga a mano).
- Recordatorio corto del día por template (sigue best-effort in-window como hoy).
- Google Calendar.
- Config por cuenta de las cadencias (constantes v1).

## Testing

- **Templates:** `sendTemplate` arma el payload correcto (mock axios); cada `build(params)` produce los `components` esperados (puro).
- **Scheduler:** `dueAppointmentEvents` — batería de casos: 24h antes dispara reminder una sola vez; T+24h con `asistio`+docs → doc_chase, sin docs → seguimiento, `no_asistio` → reagendar, `cancelada` → nada; chase respeta cadencia y máximo; idempotencia por flags.
- **Docs:** CRUD de `appointment_docs`, marcar entregado setea `delivered_at`, badge de pendientes.
- **Migraciones 0036/0037** aplicadas (SQL Editor de Supabase — la prod no tiene conexión Postgres directa; ver [[deploy-vps-manual]]).

## Criterio de "hecho"

1. `sendTemplate` entrega fuera de la ventana de 24hs (probado con un template real aprobado).
2. Recordatorio 24hs antes llega por template.
3. Post-reunión: a T+24h llega el mensaje correcto según estado/docs.
4. Docs: recepción arma checklist, el agente persigue los pendientes, recepción marca entregado, el chase se detiene.
5. Tests verdes, migraciones aplicadas, deployado.

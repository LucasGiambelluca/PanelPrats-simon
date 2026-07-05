# Agenda proactiva v1 — diseño

> Fecha: 2026-07-05 · Rama: feat-omnichannel
> Primer sub-proyecto del paradigma de "agentes por roles". Enfoque elegido por el usuario: **A (schedulers sueltos)** — extender el patrón existente sin servicio central nuevo.

## 1. Contexto y problema

Análisis de las 1.983 conversaciones reales (script `server/scripts/analyze-conversaciones.js`, corte 05-07-2026):

- **61% de no-show**: 152 de 249 citas agendadas no asistieron; solo 42 asistieron.
- **253 bookings truncados**: el bot ofreció horarios concretos y la cita nunca se cerró (de 468 que llegaron a agendado, solo 46% concretó).
- Nadie confirma asistencia, nadie retoma un agendado a medias, nadie rescata un no-show.

El recordatorio 24hs **ya se envía** (`AppointmentFollowupScheduler` + `appointments.reminder_24h_sent`); lo que falta es el ciclo completo: confirmación → detección de silencio → retoma → rescate.

## 2. Visión de roles (mapa general, para referencia)

El paradigma acordado: roles con nombre y dueño, sobre el patrón existente (código decide, LLM redacta). Estado actual:

| Rol | Hoy existe como | Hueco |
|---|---|---|
| Clasificador | `IntentClassifier` + `AreaDetector` | — |
| Entrevistador/Calificador | Tool-loop + `QualificationRules` + `set_qualification` | Libreto monolítico (proyecto aparte) |
| Verificador de citas | Gate `canStartBooking` + `BookingFlow` + `AppointmentAuditor` (post-hoc, ⚠) | Checklist bloqueante pre-creación (proyecto aparte) |
| Distribuidor de agenda | Cupos + asignación profesional + anti-solape | Optimización de carga (proyecto aparte) |
| **Recordatorios** | `AppointmentFollowupScheduler` | **Confirmación con botones — ESTE proyecto** |
| **Reagendador** | Reprogramación determinística reactiva | **Retoma + rescate proactivos — ESTE proyecto** |
| Seguimiento de casos | `followup_sent` + doc chase | CRM de expedientes (proyecto aparte) |

Los roles NO trabajan en paralelo dentro de una conversación (cadena por turno); los de fondo sí corren en paralelo como schedulers.

## 3. Alcance v1

Cuatro comportamientos, **automático con topes** (decisión del usuario):

1. Recordatorio con confirmación (botones).
2. Retoma de booking truncado.
3. Rescate de no-show.
4. Priorización de cartera en pendientes-llamar.

Templates de WhatsApp: **cargados en Meta, en revisión**. Todo se construye ya; lo que dependa de template queda detrás de un flag hasta la aprobación. La retoma de booking truncado opera dentro de la ventana de 24hs → funciona sin templates desde el día 1.

## 4. Diseño por componente

### §1 Confirmación de asistencia — extiende `AppointmentFollowupScheduler`

- El recordatorio 24hs pasa a interactivo: botones **"Confirmo"** / **"Necesito cambiarlo"**.
  - Dentro de ventana 24hs: `sendInteractive()` (ya existe en `WhatsAppOfficialClient`).
  - Fuera de ventana: template con quick replies (cuando Meta apruebe).
- La respuesta del botón llega por `parseIncoming()` (ya normaliza botón → texto). Matcher determinístico nuevo en el router:
  - "Confirmo" → `appointments.confirmado = 'confirmada'` + acuse breve.
  - "Necesito cambiarlo" → dispara la reprogramación determinística existente (slots reales).
- Sin respuesta 6hs después del recordatorio → `confirmado = 'sin_respuesta'` → entra a la planilla pendientes-llamar.
- Estados de `appointments.confirmado`: `pendiente` (default) → `confirmada` | `pide_cambio` | `sin_respuesta`.

### §2 Retoma de booking truncado — nuevo `RetomaBookingScheduler`

- Tick cada 10 min (patrón `NightReengageScheduler`).
- Detección (lógica pura `retomaDue()`): conversación `status=BOT`, sin cita futura, sin opt-out/handoff, y (último OUTBOUND ofrece horario con hora concreta — regex — o `BookingFlow` activo abandonado en Redis), con **3 a 20 hs de silencio** (garantiza ventana 24hs abierta → mensaje libre).
- Acción: 1 única retoma (texto configurable, ej. "¿le guardo el turno del martes a las 10?"). Marca `whatsapp_conversations.retoma_booking_at` → idempotente, máx 1 por conversación.
- La respuesta del cliente cae en el flujo normal (controller/BookingFlow retoman solos).

### §3 Rescate de no-show — nuevo `RescateNoShowScheduler`

- Detección (`rescueDue()`): cita con `status='no_asistio'` **explícito** (marcado por el estudio) hace 18-48 hs, sin `rescue_sent`. Una cita vencida sin marcar NO dispara rescate (podría haber asistido): esa va a la planilla pendientes-llamar como "cita vencida sin resultado".
- Acción: template "vimos que no pudo asistir, ¿reagendamos?" → casi siempre fuera de ventana ⇒ **construido pero dormido hasta aprobación de Meta** (flag).
- Marca `appointments.rescue_sent`. Respuesta → reprogramación determinística existente.

### §4 Priorización de cartera — sin scheduler

- `scorePendiente()` en `PendienteEvaluator`: calificado **gratis** > calificado **pago** > área detectada sin calificar > resto; desempate por recencia de última interacción.
- Planilla /pendientes-llamar y CSV ordenados por score. Las citas `sin_respuesta` (§1) entran con prioridad alta.

### §5 Anti-spam compartido — `canSendProactive()`

Helper puro consultado por los 3 schedulers antes de cada envío:

- Nunca a: `opt_out`, `HANDOVER`, cerrada por `frustracion_handoff`.
- Horario 9-20 (TZ AR).
- **Máx 1 mensaje proactivo por contacto por día**: `contact_memory.last_proactive_at`; cada envío proactivo lo actualiza.
- Prioridad si compiten el mismo día: confirmación > retoma > rescate.

### §6 Datos y config — migración 0036

```sql
ALTER TABLE appointments ADD COLUMN confirmado text NOT NULL DEFAULT 'pendiente';
ALTER TABLE appointments ADD COLUMN rescue_sent boolean NOT NULL DEFAULT false;
ALTER TABLE whatsapp_conversations ADD COLUMN retoma_booking_at timestamptz;
ALTER TABLE contact_memory ADD COLUMN last_proactive_at timestamptz;
ALTER TABLE accounts ADD COLUMN retoma_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN retoma_text text;
ALTER TABLE accounts ADD COLUMN rescue_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN rescue_text text;
```

(Nombres exactos a validar contra el esquema al escribir la migración.)

### §7 Manejo de errores

- Envío falla (token vencido, desconectado) → log + NO marca el flag de enviado → reintenta el próximo tick (los flags solo se setean tras envío OK, mismo patrón que `setSchedulerFlags`).
- `canSendProactive` falla al leer memoria → no envía (fail-closed: ante la duda, silencio).
- Botón con payload desconocido → cae al flujo normal del agente (no rompe nada).

## 5. Testing

- Lógica pura con unit tests (patrón `appointmentFollowupLogic.ts`): `retomaDue()`, `rescueDue()`, `canSendProactive()`, `scorePendiente()`, matcher de botones.
- Schedulers delgados (solo I/O), smoke test manual.
- Sin dependencia de Redis/Supabase en los tests de lógica.

## 6. Rollout y medición

1. Migración 0036 + deploy con flags **off**.
2. Activar solo la cuenta WhatsApp real (la de 16% de conversión).
3. Medir 1 semana re-corriendo `analyze-conversaciones.js`: no-show %, truncados retomados que cerraron cita, confirmaciones respondidas.
4. Al aprobar Meta los templates: prender §3 y la variante template de §1.

## 7. Fuera de alcance (v1)

- Libreto por rol/área (proyecto siguiente).
- Checklist bloqueante pre-cita.
- Optimización de distribución de agenda.
- CRM de seguimiento de expedientes.
- Redacción con LLM de los mensajes proactivos (textos fijos configurables en v1).

## 8. Decisiones registradas

- **Enfoque A** (schedulers sueltos) elegido por el usuario sobre la recomendación B (servicio central `AgendaAgent`). Consecuencia aceptada: la política anti-spam vive en un helper compartido (§5) en lugar de un dueño único; si en el futuro se agregan más comportamientos proactivos, reevaluar consolidar.
- Autonomía: automático con topes (sin cola de aprobación humana).
- v1 sin LLM en lo proactivo: textos fijos por cuenta.

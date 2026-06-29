# El Agente IA — Documentación Completa

> Asistente conversacional omnichannel del panel. Vive dentro del backend, atiende
> WhatsApp / Facebook / Instagram, responde preguntas, agenda citas y deriva a un
> humano cuando hace falta. Este documento describe **cómo vive en el sistema**,
> **cuándo interviene** y **cada capacidad que tiene y cómo la ejecuta**.

---

## 1. Visión general

El agente no es un único objeto: es un **sistema de tres capas de IA** que cooperan,
más un motor de flujos guiados. Según la configuración de cada cuenta, el agente puede:

- **Conducir toda la conversación** (modo `ai_first`), usando function calling para
  ejecutar acciones reales (agendar, buscar, derivar), o
- **Asistir un flujo guiado** (modo `flows`, el default), donde el bot sigue un guion
  de nodos y la IA interviene solo cuando el usuario se sale del libreto.

Toda la lógica del agente está scoped por `account_id`: cada línea/cuenta tiene su
propia personalidad, base de conocimiento, oficinas, profesionales y claves de IA.

### Las tres capas de IA

| Capa | Componente | Cuándo actúa | Qué hace |
|------|-----------|--------------|----------|
| **1 — Entrada (off-script)** | `SupportAgentService` | Mensaje entra sin matchear ningún flujo, o solo matchea el comodín `*` | Decide: responder FAQ, rutear al flujo correcto, o derivar a humano |
| **2 — Mid-flow (supervisor)** | `SupervisorService` | Usuario responde algo inesperado **dentro** de un flujo | Mapea la respuesta a una opción válida, cambia de flujo, responde un dato suelto, o deriva |
| **3 — IA-first (runtime)** | `AgentRuntime` + `ToolRegistry` | La cuenta tiene `agent_mode='ai_first'` | Conduce todo el diálogo con function calling y herramientas reales |

---

## 2. Dónde vive el agente

### Núcleo IA-first — `server/src/core/agent/`

| Archivo | Rol |
|---------|-----|
| `runtime/AgentRuntime.ts` | Orquestador del modo `ai_first`. Carga cuenta + ficha + historial, arma el prompt, e itera hasta **5 veces** ejecutando herramientas vía function calling. |
| `runtime/createAgentRuntime.ts` | Factory singleton. Carga config de cuenta (`ai_api_key`, `ai_model`, `agent_name`, `agent_persona`, `business_context`) e inyecta dependencias: KnowledgeBase, ContactMemory, AvailabilityService, AppointmentService, ToolRegistry y la función de handoff. |
| `runtime/AgentPersona.ts` | Construye el system prompt: tono, reglas fijas, contexto del estudio y ficha del contacto. |
| `runtime/ToolRegistry.ts` | Las **7 herramientas** que el agente puede invocar (ver §6). |
| `runtime/KnowledgeBase.ts` | Búsqueda de FAQs por solapamiento de keywords contra la tabla `account_faqs`. |
| `runtime/ContactMemory.ts` | Persiste y carga el contexto del contacto (perfil, preferencias, resumen). |
| `runtime/MemoryUpdater.ts` | Extrae cambios de memoria del diálogo vía IA (merge incremental, nunca borra). |
| `AgentNode.ts` | Pipeline genérico de 4 pilares (captura → tools → JSON → resolver), usado por nodos `aiAgentNode` dentro de flujos. Contrato de intents obligatorio. |
| `AgentMemory.ts` | Memoria conversacional por sesión (ventana deslizante). |

### Capas de soporte (modo flows) — `server/src/services/`

| Archivo | Rol |
|---------|-----|
| `SupportAgentService.ts` | Capa 1. Ruteo off-script + respuesta de FAQ + decisión de handoff. |
| `SupervisorService.ts` | Capa 2. Interpreta respuestas inesperadas mid-flow. |
| `AIService.ts` | Cliente LLM unificado: `complete()` y `completeWithTools()` (function calling). |

### Motor y enrutamiento — `server/src/core/engine/`

| Archivo | Rol |
|---------|-----|
| `conversation.router.ts` | **Gate principal.** Lee `account.agent_mode` y decide ai_first vs flows. Maneja estados BOT/HANDOVER. |
| `flow.engine.ts` | Máquina de estados de nodos. Resuelve triggers, ejecuta nodos, dispara las capas de IA cuando el usuario sale del libreto. |
| `executors/*` | Ejecutores de cada tipo de nodo (Appointment, Handover, BusinessHours, AIAgent, IntentResolver, etc.). |

---

## 3. Cómo entra un mensaje (el recorrido completo)

```
USUARIO ENVÍA MENSAJE (WhatsApp / Facebook / Instagram)
   ↓
WEBHOOK  →  webhooks.routes.ts
   · Verifica firma X-Hub-Signature-256
   · Enruta por external_id de la cuenta
   ↓
WebhookQueue  (cola async, durable, con retry/backoff)
   ↓
AccountManager.handleMetaWebhook() / handleWhatsAppWebhook()
   · Resuelve external_id → cuenta
   · Levanta el cliente correcto (MetaClient / WhatsAppOfficialClient / WhatsAppClient-Baileys)
   ↓
Cliente del canal  →  callback onMessage(accountId, phone, text, pushName, fileCtx)
   ↓
ConversationRouter.processMessage()              ◄── GATE PRINCIPAL
   │
   ├─ agent_mode = 'ai_first'  →  AgentRuntime.handle()         (ver §5)
   │
   └─ agent_mode = 'flows'     →  FlowEngine.processMessage()    (ver §4)
   ↓
RESPUESTA  →  AccountManager.sendMessage()  →  Usuario
```

**Durabilidad e idempotencia:** los webhooks pasan por una cola con reintentos; cada
evento se procesa por ID único para no duplicar. Todo cae en `whatsapp_messages`
(dirección, contenido, timestamp), independiente del canal.

---

## 4. Cuándo interviene el agente — modo `flows` (default)

En modo flows el bot sigue un guion de nodos. La IA **no habla por defecto**: solo
entra cuando el usuario se sale del libreto. Banderas que la disparan:

| Bandera | Significado | Quién decide |
|---------|-------------|--------------|
| `_wildcard_pending` | El mensaje no matcheó ningún trigger exacto y existe un comodín `*` | **Capa 1** — `SupportAgentService` decide responder / rutear / derivar antes de mostrar el menú |
| `_no_flow_match` | Empieza off-script, sin sesión activa | **Capa 1** — SupportAgent o Supervisor |
| `_restart_ai` | El usuario respondió algo inesperado **a mitad** de un flujo | **Capa 2** — `SupervisorService` |
| `escalate` (en nodo `question`/`poll`) | La respuesta no matchea ninguna opción válida del paso | **Capa 2** — Supervisor interpreta |

### Decisiones de la Capa 1 (`SupportAgentService.resolve`)
- `answer` → responde una FAQ directo y muestra el menú.
- `route` → reinicia el flujo correcto con el trigger adecuado.
- `handoff` → deriva a humano.
- `none` → no hay IA configurada; cae al menú comodín como fallback.

### Decisiones de la Capa 2 (`SupervisorService.interpret`)
- `fill` → mapea la respuesta libre a la opción canónica esperada (ej: "hace 2 semanas" → "< 3 meses").
- `side` → responde algo breve y vuelve a preguntar.
- `switch` → cambia a otro flujo.
- `answer` → responde un dato del estudio sin abandonar el flujo.
- `human` → deriva a humano.

### Cascada de fallbacks
```
¿Hay IA configurada?  →  ¿Hay flujos disponibles?  →  ¿Se mapea la intención?
        │ no                    │ no                         │ no
        └──────────────────────┴────────────────────────────┴──► menú comodín
```

---

## 5. Cuándo interviene el agente — modo `ai_first`

Si la cuenta tiene `agent_mode='ai_first'`, **toda** conversación pasa directamente
por el agente IA. No hay guion: el agente conduce.

`AgentRuntime.handle()`:
1. Carga la cuenta, la **ficha del contacto** y el **historial reciente** (últimos ~12 mensajes).
2. Construye el system prompt con `AgentPersona.buildPersona()`.
3. Entra en un loop (**máximo 5 iteraciones**):
   - Llama a `AIService.completeWithTools()` con las 7 herramientas disponibles.
   - Si el modelo pide ejecutar una herramienta → `ToolRegistry.execute()` y devuelve el resultado al modelo.
   - Repite hasta que el modelo produce una respuesta final de texto.
4. Si la IA falla (sin saldo, sin key, error) → mensaje cortés de fallback.

El loop permite encadenar acciones reales en un turno: por ejemplo
`list_offices → check_availability → book_appointment` antes de contestarle al usuario.

---

## 6. Capacidades y cómo las ejecuta

### 6.1 Herramientas (function calling) — modo `ai_first`

Definidas en `runtime/ToolRegistry.ts`. El modelo las invoca por nombre; cada una
valida y ejecuta contra los servicios reales.

| Herramienta | Firma | Qué hace |
|-------------|-------|----------|
| `list_offices` | `()` → `{oficinas:[{nombre, modalidad, direccion}]}` | Lista oficinas/modalidades (presencial + video). Prerrequisito para agendar. |
| `check_availability` | `(desde, hasta, oficina)` → `{slots:[{start_time, end_time}]}` | Slots libres en fecha/oficina. Máx 3. |
| `book_appointment` | `(nombre, start_time, end_time, oficina, resumen)` → `{appointment_id, modalidad, direccion, video_link}` | Agenda. Valida capacidad y asigna profesional disponible. |
| `reschedule_appointment` | `(appointment_id, start_time, end_time)` → `{ok}` | Reprograma. Valida ownership (account + teléfono). |
| `cancel_appointment` | `(appointment_id)` → `{ok}` | Cancela (status `cancelada`). Valida ownership. |
| `search_knowledge` | `(query)` → `{encontrado, snippets[]}` | Busca FAQs de la cuenta. **Grounding estricto:** sin hit → `encontrado:false`. |
| `handoff_to_human` | `(motivo, resumen_caso)` → `{handoff:true}` | Deriva: marca la conversación en HANDOVER. |

> **Regla de oro del prompt:** para temas previsionales el agente **debe** usar
> `search_knowledge` (nunca inventa); para agendar debe seguir
> `list_offices → check_availability → ofrecer → confirmar → book_appointment`,
> y nunca inventa horarios.

### 6.2 Agendamiento de citas (motor completo)

Disponible tanto vía herramientas (ai_first) como vía nodos `appointment*` (flows).

- **Motor de disponibilidad** (`AvailabilityService`): cascada
  **Modalidad** (presencial/video) → **Zona** (CABA / Quilmes / Haedo) →
  **Profesional disponible** (cruza `office_professionals`, `professional_availability`,
  `professional_blocks`). Duración de slot 60 min default (`slot_min` configurable).
- **Resolución de fecha preferida**: si el usuario rechaza los slots inmediatos,
  interpreta "el jueves", "semana que viene", "2026-07-10".
- **Filtro por turno**: "mañana" (09–13h) / "tarde" (13–18h).
- **Estados de cita**: `pendiente | confirmada | cancelada | asistio | no_asistio | cerrado`.
- **Ficha de recepción** (migración 0023): `motivo`, `dni`, `canal_origen`, `carpeta`,
  `resultado`, `atendido_por`.
- **Notificación a la operadora**: al agendar, manda WhatsApp al número del estudio.
- **Recordatorios** (`ReminderScheduler`): N minutos antes (`reminder_minutes`,
  default 20). Respeta la **ventana de 24h** de WhatsApp (solo si hubo inbound reciente).
  Marca **no-show** automático al cierre del día.

### 6.3 Base de conocimiento (FAQs)

- Tabla `account_faqs` (`pregunta`, `respuesta`, `tags`), scoped por cuenta.
- Seed inicial (`seed-faqs.ts`): ~14 FAQs (jubilación, pensión, despido, ART, moratoria,
  requisitos, horarios, ubicaciones, costos…).
- Búsqueda (`KnowledgeBase.search`): normaliza (sin acentos, minúsculas), puntúa por
  solapamiento de tokens query↔pregunta/tags, devuelve top 3 si score ≥ 1.
- En modo flows, las FAQs se inyectan en el `business_context` del prompt para que la
  Capa 1 responda sin rutear.

### 6.4 Handoff a humano

Disparadores:
- ai_first: el modelo invoca `handoff_to_human` (usuario lo pide, está frustrado, o el tema queda fuera de alcance).
- flows: `SupportAgentService` → `handoff`, o `SupervisorService` → `human`, o un nodo `handover` explícito.

Mecanismo:
- Marca `flow_executions.status = 'HANDOVER'` y `whatsapp_conversations.status = 'HANDOVER'`.
- Manda un mensaje de transición ("Te derivo con un asesor humano…").
- **El bot se calla**: el router ignora nuevos mensajes mientras el estado sea HANDOVER.
- **Recuperación**: "hola" / "menu" resetea la conversación a BOT.

### 6.5 Memoria y contexto

- `contact_memory` (por cuenta+teléfono): `profile` (nombre, edad, situación previsional…),
  `preferences` (horario preferido…), `long_term_summary` (texto acumulado).
- `fichaText`: línea compacta para el prompt, ej:
  `FICHA: Juan, 62, jubilado. Próxima cita: mié 03/07 14:00 hs.`
- Actualización (`MemoryUpdater`): la IA extrae cambios del diálogo y los suma —
  **merge incremental, nunca borra**.
- Historial corto: últimos ~12 mensajes (INBOUND→`user`, OUTBOUND→`assistant`).
- Persistencia: **Redis** (sesiones / historial corto, TTL 30 días) + **Supabase** (datos permanentes).

### 6.6 Multicanal (omnichannel)

| Canal | Cliente | Identidad |
|-------|---------|-----------|
| WhatsApp Baileys (QR) | `WhatsAppClient` | teléfono normalizado |
| WhatsApp Official (Meta Cloud API) | `WhatsAppOfficialClient` | teléfono (wa_id) |
| Facebook Messenger | `MetaClient` | PSID |
| Instagram Direct | `MetaClient` | IGSID |

Gestión centralizada en `AccountManager`: `connect()`, `handleMetaWebhook()`,
`handleWhatsAppWebhook()`, `sendMessage()`. Mismo cliente → misma memoria, historial y
sesión, indistinto del canal de origen.

---

## 7. Configuración por cuenta

Columnas en la tabla `accounts` (migración 0008+):

| Campo | Tipo | Propósito |
|-------|------|-----------|
| `agent_mode` | `'flows'` \| `'ai_first'` | Elige motor (default `flows`). |
| `agent_name` | string | Nombre del agente (default **"Sofía"**). |
| `agent_persona` | string | Tono/personalidad extra del estudio. |
| `business_context` | string | Datos del estudio (horarios, dirección, precios, servicios). |
| `ai_support_enabled` | bool | Activa la Capa 1 (SupportAgent) en modo flows. |
| `ai_api_key` | string (secreto) | Clave del LLM por cuenta (OpenAI/Groq/Gemini). Oculta a empleadas. |
| `ai_model` | string | Modelo (gpt-4o-mini, llama-3.3-70b, gemini-1.5-flash…). |
| `ai_support_prompt` | string | System prompt custom para Capa 1/2. |
| `reminder_minutes` | int | Minutos antes de la cita para el recordatorio (default 20). |

Cambios vía `POST /api/accounts/:id` (solo admin). `ai_api_key` se enmascara para roles no-admin.

---

## 8. Personalidad y prompt (modo `ai_first`)

Construido por `AgentPersona.buildPersona()`. Interpola `agent_name`, nombre del estudio,
`agent_persona`, `business_context` y la ficha del contacto. Tono fijo:

- Tuteo, frases cortas, usa el nombre de la persona.
- Valida la emoción del usuario; una sola pregunta por turno.
- Sin jerga legal; emojis ocasionales; varía el fraseo.

Reglas duras:
- Temas previsionales → **solo** lo que devuelva `search_knowledge` (no inventa).
- Confirma antes de agendar.
- Si el usuario se frustra → `handoff_to_human`.
- Para agendar sigue la secuencia oficina → disponibilidad → ofrecer → confirmar → reservar.

---

## 9. Estados de conversación

| Estado | Dónde vive | Significado |
|--------|-----------|-------------|
| `BOT` | `whatsapp_conversations.status` | Bot activo, respondiendo. |
| `HANDOVER` | `whatsapp_conversations.status` + `flow_executions.status` | Tomada por humano; el bot se calla. |
| `active` | `flow_executions.status` | Sesión de flujo en curso. |

---

## 10. Ejemplo de punta a punta (modo flows)

Usuario escribe **"me dejaron sin laburo"**:

1. Webhook → `ConversationRouter.processMessage()`.
2. No es shortcut ("hola"/"cancelar"/"reset").
3. `FlowEngine` matchea trigger → flujo **"Despido"**; crea sesión.
4. Bot: "¿Hace cuánto te echaron?" (opciones: `< 3 meses`, `3–6 meses`, `> 6 meses`).
5. Usuario: "hace 2 semanas" → no matchea ninguna opción → `escalate`.
6. **Capa 2** (`SupervisorService`) → `fill`: mapea a `< 3 meses`. El flujo avanza.
7. Bot: "¿Qué edad tenés?" → captura `edad = 61`.
8. `BusinessHoursExecutor`: ¿fuera de horario? No → sigue.
9. `AppointmentProposalsExecutor`: propone slot con profesional disponible.
10. `AppointmentExecutor`: agenda (`status='pendiente'`), resumen "Despido, 2 semanas, 61 años".
11. Notifica a la operadora por WhatsApp.
12. `ReminderScheduler`: recordatorio 20 min antes.

---

## 11. Mapa rápido archivo → capacidad

| Capacidad | Ubicación |
|-----------|-----------|
| Gate ai_first vs flows | `core/engine/conversation.router.ts` |
| Runtime ai_first | `core/agent/runtime/AgentRuntime.ts`, `createAgentRuntime.ts` |
| Herramientas (7) | `core/agent/runtime/ToolRegistry.ts` |
| System prompt / persona | `core/agent/runtime/AgentPersona.ts` |
| FAQs | `core/agent/runtime/KnowledgeBase.ts`, `scripts/seed-faqs.ts` |
| Capa 1 (off-script) | `services/SupportAgentService.ts` |
| Capa 2 (mid-flow) | `services/SupervisorService.ts` |
| Cliente LLM / function calling | `services/AIService.ts` |
| Motor de flujos | `core/engine/flow.engine.ts` |
| Agendamiento | `AppointmentService`, `executors/Appointment*Executor` |
| Disponibilidad | `AvailabilityService` |
| Handoff | `executors/HandoverExecutor`, `conversation.router.ts` |
| Memoria | `core/agent/runtime/ContactMemory.ts`, `MemoryUpdater.ts` |
| Multicanal | `core/accounts/AccountManager.ts`, clientes `*Client.ts` |
| Recordatorios | `ReminderScheduler` |
| Webhooks | `api/routes/webhooks.routes.ts`, `services/WebhookQueue.ts` |

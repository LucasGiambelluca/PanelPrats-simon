# Spec — Agente IA-primero para el bot de WhatsApp

**Fecha:** 2026-06-22
**Rama base:** `feat-omnichannel`
**Estado:** Diseño aprobado, pendiente de plan de implementación
**Contexto de negocio:** Estudio previsional (PYS). Clientes frecuentemente mayores/jubilados, con dudas y ansiedad sobre trámites. Marca "Trust & Authority".

---

## 1. Objetivo

Hacer el bot más **agéntico, con memoria y más humano**. Hoy es "flujo-scripteado primero, IA como triage/respaldo": memoria volátil (ventana de 20 msgs en RAM que se pierde al reiniciar), personalidad fragmentada (config de cuenta + prompts de nodo + strings hardcodeados), y la IA solo decide ruteo/derivación.

Se migra a un modelo **IA-primero con herramientas (tools)**: un agente conduce la conversación y las acciones (agendar, responder FAQ, derivar) son tools que el agente invoca. Con:
- **Memoria largo plazo por contacto** (perfil, resúmenes, citas, preferencias).
- **Personalidad cálida pero profesional**, unificada en un solo lugar.
- **Grounding estricto** para no inventar información previsional (riesgo legal).
- **Rollout de piloto** en una sola cuenta, con kill-switch.

### Decisiones tomadas (brainstorming)
| Tema | Decisión |
|---|---|
| Dirección | IA-primero con tools |
| Tools | agendar/reprogramar/cancelar citas · FAQ previsional · calificar+derivar (sala de video NO por ahora) |
| Memoria largo plazo | perfil + resúmenes de charlas + historial de citas + preferencias |
| Personalidad | cálida pero profesional |
| Grounding | estricto: solo base del estudio; si no sabe, deriva |
| Rollout | piloto en 1 cuenta por flag, con kill-switch |
| Enfoque técnico | loop de tool-calling propio sobre el `AIService` actual (no framework, no Assistants nativo) |

### No-objetivos (YAGNI)
- No vector search/embeddings al inicio (KB por keyword; se agrega si la base crece).
- No tool de sala de videollamada en esta iteración.
- No reemplazo total: las otras cuentas siguen con flujos scripteados.
- No reescribir agenda/envío/idempotencia: se reutilizan los servicios actuales.

---

## 2. Arquitectura

### Punto de enganche
El agente se intercepta en `ConversationRouter`, **antes** del `FlowEngine`, gateado por un flag de cuenta `agent_mode`.

```
inbound (webhook ya verificado + idempotente — B1/A1 ya implementados)
        │
   ConversationRouter
        │  ¿account.agent_mode == 'ai_first'?
        ├── NO ──► FlowEngine (camino actual, SIN cambios)
        └── SÍ ──► AgentRuntime.handle(accountId, phone, text, fileCtx)
```

### Loop del `AgentRuntime`
```
1. Cargar contexto:
   - persona (system prompt cálido-profesional + reglas de grounding)  → AgentPersona
   - memoria largo plazo del contacto (perfil + resúmenes + citas + prefs) → ContactMemory
   - historial reciente (últimos ~10-15 msgs de whatsapp_messages)
   - base de conocimiento de la cuenta (para grounding)               → KnowledgeBase
2. Llamar al modelo con las tools registradas (function-calling nativo)
3. ¿el modelo pidió una tool?
     SÍ → ejecutar tool (identidad server-side) → devolver resultado al modelo → volver a 2
     NO → texto final → enviar al cliente (vía manager.sendMessage)
4. Persistir el turno (whatsapp_messages, ya existe) + encolar actualización de memoria
   Límite duro: ~5 iteraciones/mensaje + tope de tokens. Si se excede → cortesía + handoff.
```

### Componentes (responsabilidad única)
| Componente | Qué hace | Depende de |
|---|---|---|
| `AgentRuntime` | orquesta el loop, controla iteraciones/tokens, maneja errores | `AIService`, `ContactMemory`, `ToolRegistry`, `AgentPersona` |
| `ToolRegistry` | define esquemas de tools + las ejecuta con identidad server-side | `AppointmentService`, `KnowledgeBase`, `HandoverExecutor` |
| `ContactMemory` | lee/escribe memoria largo plazo por contacto | Supabase (`contact_memory`) + caché Redis + `AppointmentService` (citas) |
| `KnowledgeBase` | recupera FAQ relevante de la cuenta (grounding) | Supabase (`business_context` + `account_faqs`) |
| `AgentPersona` | arma el system prompt por capas (tono + reglas + datos + ficha) | config de cuenta + `ContactMemory` |

**Reutiliza:** `AIService` (multi-provider OpenAI→Groq→Gemini), `AppointmentService` (con constraint anti-overlap), `HandoverExecutor`, `MessageStore`, idempotencia/cola de webhooks (B1/A1). El agente NO reimplementa agenda ni envío.

**Modelo de arranque:** `gpt-4o-mini` (barato, soporta function-calling). Configurable por cuenta (`ai_model`); se sube si la calidad lo pide. La key sigue el patrón actual (en la config de la cuenta, no env).

---

## 3. Modelo de memoria largo plazo

Una fila por contacto: `contact_memory`, clave `(account_id, phone)`.

```
contact_memory
├── account_id        uuid    (FK, aislamiento por cuenta)
├── phone             text
├── profile           jsonb   -- { nombre, edad, situacion_previsional, dni?, localidad, notas[] }
├── preferences       jsonb   -- { horario_preferido, trato, temas_interes }
├── long_term_summary text    -- resumen rodante de TODAS las charlas (~150 palabras)
├── last_summary_at   timestamptz
└── updated_at        timestamptz
   UNIQUE(account_id, phone) + índice (account_id, phone) + RLS por cuenta
```

| Memoria | Dónde vive | Por qué |
|---|---|---|
| Perfil del cliente | `profile` jsonb (slot-filling, merge incremental) | se completa solo; nunca pisa con null |
| Resumen de charlas | `long_term_summary` (rodante) | 1 texto que se actualiza, no N filas que crecen sin fin |
| Historial de citas | se consulta `appointments` (NO se duplica) | ya es fuente de verdad con su constraint |
| Preferencias | `preferences` jsonb | estructurado, fácil de inyectar |

**Lectura (al armar contexto):** `ContactMemory.load(account, phone)` arma un bloque compacto "Ficha del contacto" que se inyecta en el system prompt. Ej:
```
FICHA: María, 63. Le faltan 2 años de aportes, consultó moratoria.
Próxima cita: jue 26/6 11hs. Prefiere mañanas. Pendiente: traer recibos.
```
Caché Redis (TTL corto) para lecturas calientes; Supabase = fuente de verdad.

**Escritura (actualización):** NO en cada mensaje. Se dispara al cierre de conversación (o cada N turnos / debounce), **fuera del camino de respuesta** (no agrega latencia). Una llamada barata al modelo (`AIService.extractJSON`):
1. extrae/mergea slots de `profile` y `preferences` (solo agrega),
2. reescribe `long_term_summary` integrando lo nuevo.

**Contexto reciente (dentro de la charla):** además de la memoria largo plazo, el loop pasa los últimos ~10-15 mensajes desde `whatsapp_messages`. Resuelve "contexto de la conversación" sin estado en RAM.

**Privacidad:** `profile` guarda PII; vive en Supabase (que ya guarda mensajes), con RLS por cuenta; el masking del logger evita filtrarlo. Borrable por contacto (derecho al olvido).

---

## 4. Tools: contrato y barandas

6 tools, cada una envuelve un servicio existente. El modelo elige y arma argumentos; la ejecución es código nuestro.

| Tool | Params (el modelo llena) | Ejecuta | Devuelve |
|---|---|---|---|
| `check_availability` | `{ desde, hasta, oficina? }` | `AppointmentService` (slots libres) | lista de horarios |
| `book_appointment` | `{ nombre, start_time, end_time, oficina?, resumen }` | `AppointmentService.create` | `{ ok, appointment_id }` / `SLOT_TAKEN` |
| `reschedule_appointment` | `{ appointment_id, start_time, end_time }` | `AppointmentService.update` | `{ ok }` / `SLOT_TAKEN` |
| `cancel_appointment` | `{ appointment_id }` | `AppointmentService.update(status=cancelada)` | `{ ok }` |
| `search_knowledge` | `{ query }` | `KnowledgeBase` | snippets relevantes o `{ encontrado:false }` |
| `handoff_to_human` | `{ motivo, resumen_caso }` | `HandoverExecutor` | marca HANDOVER, corta el bot |

### Barandas
1. **Identidad server-side.** `account_id` y `phone` se inyectan desde la sesión al ejecutar la tool; el modelo nunca los manda. El agente no puede operar sobre otro contacto (evita IDOR vía LLM). El modelo solo aporta datos del turno.
2. **Confirmar antes de mutar.** Antes de `book/reschedule/cancel`, el agente repite los datos al cliente y espera confirmación. La tool además re-valida (constraint anti-overlap → `SLOT_TAKEN` se maneja re-ofreciendo).
3. **Grounding estricto.** Toda pregunta previsional pasa por `search_knowledge`. Si `encontrado:false` → el agente NO improvisa: lo dice y ofrece `handoff_to_human`. No existe tool de "responder de memoria".
4. **Derivación siempre disponible.** `handoff_to_human` invocable en cualquier momento (pedido del cliente, agente no puede resolver, tema sensible, frustración). Pasa `resumen_caso` para que la persona retome sin que el cliente repita.

### Manejo de error por tool
`SLOT_TAKEN` → re-ofrecer; servicio caído → mensaje de cortesía + handoff; nunca error crudo al cliente. Errores logueados (con masking) + Sentry.

### `KnowledgeBase` (nuevo)
Arranca simple: lee `business_context` de la cuenta + tabla `account_faqs`. Recuperación por keyword/similitud (sin embeddings al inicio — YAGNI). Interfaz estable para sumar vector search después sin tocar consumidores.

---

## 5. Personalidad y grounding (system prompt)

Un solo lugar arma el prompt: `AgentPersona.build(account, contactFicha)`. Fin de los strings hardcodeados ("Disculpá, no te seguí") en el camino IA-primero.

**Prompt por capas:**
1. **Identidad** — "Sos {agent_name}, asistente del {nombre_estudio}." (`agent_name` configurable, default `Sofía`).
2. **Tono** — reglas concretas (abajo).
3. **Grounding** — reglas duras.
4. **Datos del estudio** — horarios, oficinas, modalidades (config de cuenta).
5. **Ficha del contacto** — la línea de `ContactMemory`.
6. **Uso de tools** — cuándo llamar cada una.

**Tono cálido-profesional → reglas concretas:**
- Tuteo. Frases cortas, estilo WhatsApp (a veces 2 mensajitos, no párrafos).
- Usar el nombre cuando se sabe.
- Validar la emoción primero si hay angustia.
- Una pregunta a la vez (clave con gente mayor).
- Cero jerga legal innecesaria; si hay un término, explicarlo simple.
- Emojis con cuentagotas (1 ocasional).
- Variar el fraseo (no repetir muletillas).

**Grounding (reglas duras):**
- Temas previsionales (montos, plazos, requisitos, leyes) → SOLO desde `search_knowledge`. Si no está → "Eso prefiero que te lo confirme bien el estudio" + `handoff_to_human`. Nunca inventar.
- Antes de agendar/reprogramar/cancelar → repetir datos y esperar confirmación.
- Frustración o pedido de humano → derivar con resumen.

**Ejemplo (antes vs después):**
```
Cliente: "hola necesito saber si me puedo jubilar me faltan aportes"

HOY:    "Disculpá, no te seguí. Escribí *hola* para ver el menú."

AGENTE: "Hola, soy Sofía del estudio 🙂 Entiendo, lo de los aportes
         preocupa. Contame, ¿cuántos años tenés y cuántos de aporte
         te faltarían, más o menos?"
        → search_knowledge(moratoria/aportes) → responde SOLO con lo
          de la base; si es puntual, ofrece agendar o derivar.
```

**Config nueva por cuenta:** `agent_name` (default `Sofía`), `agent_persona` (override de tono opcional). Sin setear → default cálido-profesional sensato.

---

## 6. Datos y migraciones

**Migración `0015_agent_runtime.sql`** (idempotente, aplicada por `/sync-db` ya corregido):
```sql
-- memoria por contacto
CREATE TABLE IF NOT EXISTS contact_memory (
  account_id uuid NOT NULL, phone text NOT NULL,
  profile jsonb DEFAULT '{}', preferences jsonb DEFAULT '{}',
  long_term_summary text, last_summary_at timestamptz, updated_at timestamptz DEFAULT now()
);  -- UNIQUE(account_id, phone) + índice + RLS

-- base de conocimiento del estudio
CREATE TABLE IF NOT EXISTS account_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL, pregunta text, respuesta text,
  tags text[], created_at timestamptz DEFAULT now()
);  -- índice (account_id) + RLS

-- config del agente
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_mode text DEFAULT 'flows';   -- 'flows' | 'ai_first'
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_name text DEFAULT 'Sofía';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_persona text;
```
**Reusa sin tocar:** `appointments`, `whatsapp_messages`, `business_context`.
**Default seguro:** `agent_mode='flows'` → ninguna cuenta cambia hasta prender el flag en la piloto.

---

## 7. Testing, métricas y kill-switch

**Tests (modelo mockeado, determinista — como se mockea `AIService` hoy):**
- `ToolRegistry`: cada tool — binding de identidad server-side, `SLOT_TAKEN`, `encontrado:false`.
- `AgentRuntime`: loop tool-call→ejecutar→texto final; tope de iteraciones; error de servicio → handoff (no crudo).
- `ContactMemory`: merge sin pisar con null; update de resumen.
- `KnowledgeBase` + grounding: sin hit → camino de derivación (NO respuesta inventada). **Test clave.**
- `AgentPersona`: armado del prompt por capas.
- Smoke e2e: happy path de agendado; FAQ-no-encontrada → handoff.

**Métricas del piloto (para decidir si se extiende):**
% conversaciones resueltas sin humano · nº derivaciones · citas agendadas por el bot · latencia por respuesta · costo por conversación (tokens) · flag manual de alucinación. Eventos logueados estructurados (con masking).

**Kill-switch:** `agent_mode='flows'` en la cuenta → vuelve al flujo actual al instante, sin deploy.

**Costo/seguridad:** flag default off, máx ~5 iteraciones/mensaje, tope de tokens, grounding estricto, identidad server-side, confirmación antes de mutar.

---

## 8. Orden de implementación sugerido (para el plan)
1. Migración `0015` + columnas de cuenta + flag.
2. `KnowledgeBase` (lectura de `business_context`/`account_faqs` + recuperación keyword) + tests.
3. `ContactMemory` (load/merge/summary) + tests.
4. `ToolRegistry` (6 tools, identidad server-side) + tests por tool.
5. `AgentPersona` (prompt por capas) + tests.
6. `AgentRuntime` (loop, límites, manejo de error) + tests.
7. Enganche en `ConversationRouter` detrás del flag + smoke e2e.
8. Instrumentación de métricas + activar piloto en 1 cuenta.

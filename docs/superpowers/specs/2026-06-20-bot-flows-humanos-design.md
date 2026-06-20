# Diseño — Flujos del bot más humanos (detector barato + IA en rol)

Fecha: 2026-06-20
Branch: feat-omnichannel
Estado: aprobado (brainstorming), pendiente plan de implementación

## Objetivo

Refinar los flujos de respuesta del bot de WhatsApp del estudio previsional para que:

1. Pueda **responder ante cualquier pregunta** manteniéndose en su rol de atención al público.
2. Lo haga **sin gastar tokens de IA en cada mensaje**: un detector barato (sin IA) decide si el usuario sigue el flujo o se desvía; la IA solo se invoca cuando se confirma el desvío (off-script).
3. **Evite menús numerados** ("1. …, 2. …"): entrada por pregunta abierta + botones nativos de respaldo.
4. **No pida apellido**: solo nombre de pila.
5. Tenga un **comportamiento más humano** (tono, mensajes, saludo).

Enfoque elegido: **A — extender los servicios existentes** (no reescribir el motor de flujos). Se agrega un módulo de gateo barato y una acción de respuesta en rol a los agentes IA ya presentes.

## Contexto actual (lo que ya existe)

- `server/src/core/engine/conversation.router.ts` — entrada global. Maneja cancelar/saludo/handover y las señales `_wildcard_pending`, `_no_flow_match`, `_restart_ai` del motor, delegando a `SupportAgentService`.
- `server/src/core/engine/flow.engine.ts` — motor. `handleInput()` (línea ~426) ya hace gateo barato parcial: `pollNode` resuelve numérico → exacto (fold sin acentos) → fuzzy parcial → recién ahí `SupervisorService` (IA). `questionNode`/genérico usa `gatherExpectedOptions` + `optionMatchesDirect` antes de IA. `stepExpectsNumber` extrae número.
- `server/src/services/SupportAgentService.ts` — agente global off-script. Hoy solo `route | handoff | none`. `loadAccountContext()` ya lee `accounts.ai_*` (migración 0008) y los flujos activos.
- `server/src/services/SupervisorService.ts` — agente mid-flujo. Hoy `fill | side | switch | human | none`. `side` responde genérico, sin datos del estudio.
- `server/src/core/executors/PollExecutor.ts` — ya emite `interactive` (botones ≤3, lista ≤10) con API oficial; fallback de texto numerado con "_Respondé con el número_".
- `server/scripts/apply-jub-sexo.js` — flujo jubilación: pide "nombre y apellido" e infiere sexo por nombre vía `intentResolverNode`.

### Brechas vs objetivo

- No hay detector explícito con señales de **pregunta**, **largo/forma** ni **contador de reintentos**: el primer intento dudoso ya salta a IA, sin re-preguntar gratis antes.
- La IA **no responde en rol**: solo rutea o deriva; `side` contesta genérico sin datos del estudio.
- No existe fuente de datos del estudio para responder sin inventar.
- El menú es numerado y pide tipear número.
- Se pide apellido.

## Decisiones de diseño (confirmadas con el usuario)

- Off-script: la IA **responde en rol + rutea** (no solo rutea).
- Detector barato combina **las 4 señales**: match opciones · heurística de pregunta · largo/forma · contador de reintentos.
- Menú: **híbrido** — pregunta abierta + botones de respaldo.
- Apellido: **solo nombre de pila** (la inferencia de sexo sigue usando el nombre).
- Datos del estudio: **campo `business_context` por cuenta** (única fuente de `answer`).

---

## Sección 1 — `ConversationGate` (detector barato, sin IA)

Módulo nuevo: `server/src/core/engine/ConversationGate.ts`. Funciones puras, sin DB ni red. Lo invoca `handleInput` ANTES de cualquier IA. Centraliza la lógica fold/fuzzy que hoy está inline en `pollNode`.

**Entrada:** `{ input, expectedOptions, retryCount, maxRetries?, synonyms? }`.

**Salida** (unión discriminada):

- `{ decision: 'match', value }` — input matchea una opción. Resolución: exacto (fold sin acentos) → fuzzy parcial (includes en ambos sentidos) → sinónimos del nodo. Cero IA.
- `{ decision: 'reprompt' }` — no matcheó, pero `retryCount < maxRetries` (default `maxRetries = 1`). Re-pregunta el paso, **sin IA**. El caller incrementa el contador en la sesión.
- `{ decision: 'escalate', reason }` — escala a IA. `reason ∈ { 'question', 'long', 'retry_exhausted' }`.

**Orden de evaluación:**

1. `match` → si resuelve, listo.
2. **`question`**: input contiene `?` o palabra-pregunta (`cómo|como|cuándo|cuando|dónde|donde|cuánto|cuanto|por qué|porque|atienden|atiende|cuesta|precio|valor|horario|ubicad|dónde queda|qué hacen|que hacen`). Escala YA (querer info ≠ fallar el paso; no consume reintento).
3. **`long`**: `input.length > 120` o ≥2 oraciones (split por `. `/`?`/`!` con ≥2 fragmentos no triviales). Relato/multi-tema → escala.
4. **`retry < maxRetries`** → `reprompt`.
5. Si no → `escalate('retry_exhausted')`.

**Config por nodo (opcional):** `max_retries` (default 1), `synonyms` (array; ya hay sinónimos sueltos hoy). Umbrales (`LONG_CHARS = 120`, palabras-pregunta) como `const` del módulo.

**Estado de reintentos:** variable de sesión `_gate_retries_<nodeId>`. Se incrementa en `reprompt`, se limpia al avanzar de nodo.

**Test:** unit puro por señal (match exacto/fuzzy/sinónimo; question con/sin `?`; long por chars y por oraciones; reprompt vs retry_exhausted). Sin DB ni IA.

---

## Sección 2 — IA en rol (responde + rutea + deriva)

Solo cuando `ConversationGate` devuelve `escalate` se invoca IA. Una sola llamada decide y, si corresponde, responde.

**`SupportAgentService.resolve()`** — extender la acción:

```ts
{ action: 'answer' | 'route' | 'handoff', reply?: string, trigger?: string }
```

- `answer` → pregunta general del estudio. IA responde en rol usando `business_context` inyectado. `reply` = texto al usuario.
- `route` → intención de gestión → `trigger` de flujo (igual que hoy; valida trigger real, anti-alucinación).
- `handoff` → no sabe / frustrado / pide humano (igual que hoy).

**Bloque nuevo en el system prompt:**

```
DATOS DEL ESTUDIO (única fuente para responder):
{{business_context}}

REGLAS answer:
- Respondé SOLO con datos de arriba. Tono humano, breve, en rol de atención.
- Si tras responder conviene avanzar una gestión, ofrecela ("¿Te agendo?").
- Si el dato NO está arriba: NO uses answer. Usá handoff.
```

**Anti-alucinación:** validación post-IA — si `action === 'answer'` y `business_context` está vacío → forzar `handoff`. `route` mantiene su validación de trigger.

**`SupervisorService.interpret()`** (mid-flujo): mismo agregado `answer`, reusa `business_context`. Tras responder `answer`, re-pregunta el paso actual (mismo manejo que `side`).

**`conversation.router.ts`:** en las ramas `_wildcard_pending`, `_no_flow_match`, `_restart_ai`, manejar `decision.action === 'answer'` → devolver `[decision.reply]`, sin tocar handover ni sesión. Si `reply` vacío → `handoff` fallback.

**Costo:** sigue 1 llamada IA por mensaje off-script. El gate barato la evita en on-script.

---

## Sección 3 — Menú híbrido (pregunta abierta + botones, sin números)

**Entrada nueva (2 pasos):**

1. **Pregunta abierta** (`questionNode`): `"¡Hola{{nombre}}! 👋 Contame, ¿en qué te puedo ayudar?"`. Espera texto libre.
2. Input → **gate + IA** (secciones 1-2):
   - matchea / IA detecta área → `route` al flujo correcto. Directo, sin mostrar menú.
   - IA `answer` → responde la duda y reofrece avanzar.
   - **ambiguo / pide ver opciones / gate `reprompt`** → mostrar **`pollNode` con botones** de respaldo.

**Botones sin números:** `PollExecutor` ya emite `interactive` con API oficial. Cambios:

- Texto fallback (Baileys, sin API oficial): quitar prefijos `*1.* *2.*` y la línea `"_Respondé con el número…_"`. Mostrar opciones como viñetas. El match por texto lo resuelve el gate (ej "me echaron" → Despido). Si el usuario tipea un número, sigue funcionando, pero no se lo pide.
- `pollNode.data`: flag nuevo `style: 'buttons' | 'numbered'` (default `'buttons'`). `'numbered'` preserva el comportamiento viejo para flujos existentes.

**Áreas (labels acortados a límites WhatsApp — botón ≤20, list row ≤24):** "Jubilación / ANSES" · "Despido / Trabajo" · "Otra consulta". Las 6 opciones actuales entran en `list` con API oficial; con Baileys, viñetas. Acortar "Despido / ART / Trabajo en negro" → "Despido / Trabajo".

**Reingreso:** `GLOBAL_BREAKERS` (`hola`, `menu`, …) ya muestran el menú directo; apuntan al nuevo `pollNode` de respaldo.

---

## Sección 4 — Apellido → solo nombre + tono humano

**Apellido:** `grep` amplio de `apellido` en seeds/flujos. Donde pida "nombre y apellido", cambiar a nombre de pila.

- `apply-jub-sexo.js` (~línea 35): `'Perfecto 👍 ¿A nombre de quién hacemos la consulta? (nombre y apellido)'` → `'Perfecto 👍 ¿Cómo te llamás?'`. La inferencia de sexo (`intentResolverNode`) clasifica el nombre → mujer/hombre; usa el primer token = nombre. Funciona igual. `user_prompt` ya manda `{{input}}` crudo.
- Aplicar el mismo criterio a cualquier otro flujo/seed con "apellido".

**Captura de nombre para el saludo:** usar `nombre` del flujo si se pidió; si no, `global.pushName`. Interpolación `{{nombre}}` con **fallback vacío**: si la var falta, reemplazar por `''` y colapsar el doble espacio → nunca `"¡Hola undefined!"`. Helper de interpolación segura (centralizar el `replace` de `{{var}}` que hoy está en `MessageExecutor`).

**Tono humano:**

- Reprompt duro `"⚠️ No entendí tu respuesta. Por favor, elegí una opción válida"` → `"Disculpá, no te seguí 🙈 ¿me lo decís de nuevo?"`. (Este reprompt ahora lo gobierna el gate, sección 1.)
- `DEFAULT_HANDOFF_MESSAGE` ya es humano; se mantiene.
- Prompts IA (`answer`): instrucción de tono "humano, breve, cercano, voseo argentino, sin sonar robot, máx 1 emoji".
- Quitar lenguaje de máquina visible ("Respondé con el número", "opción válida", prefijos `1.`).

Sin cambios de esquema en esta sección. Solo texto + helper de interpolación.

---

## Sección 5 — Datos del estudio (`business_context`) + migración + wiring

**Migración nueva** `supabase/migrations/0012_account_business_context.sql`:

```sql
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_context text DEFAULT '';
```

Texto libre por cuenta: horario, servicios, dirección, qué hacen, qué NO hacen. Única fuente para `answer`.

**Carga:** `SupportAgentService.loadAccountContext()` ya hace `select` de `accounts`. Sumar `business_context` al select y exponerlo en `SupportConfig.businessContext`. Tolerante si la columna no existe (try/catch ya presente).

**Wiring `answer`:**
- `SupportAgentService.resolve()` → inyecta `businessContext` en el system prompt; valida (vacío ⇒ no `answer`).
- `SupervisorService.interpret()` → mismo `businessContext` para `answer` mid-flujo.
- `conversation.router.ts` → ramas `_wildcard_pending` / `_no_flow_match` / `_restart_ai`: manejar `action='answer'`.

**Edición admin:** agregar textarea `business_context` en la pantalla de cuenta del panel (frontend). El campo funciona aunque inicialmente se cargue por SQL — el textarea puede quedar para una iteración aparte sin bloquear el resto.

---

## Manejo de errores (global)

- IA cae/timeout → `handoff` (ya está).
- `business_context` vacío + `answer` → `handoff`.
- `ConversationGate` nunca llama red → no puede fallar por IO.
- Compatibilidad hacia atrás: `style` default `'buttons'`; `max_retries` default 1; flujos viejos sin tocar.

## Testing

- Unit `ConversationGate` (puro, por señal).
- Unit `SupportAgentService` / `SupervisorService`: mock IA → `answer` con/sin context, `route`, `handoff`.
- Integración `conversation.router`: off-script pregunta → `answer`; off-script gestión → `route`; ambiguo → menú botones.
- Actualizar `server/scripts/test-menu.ts` para la entrada nueva (pregunta abierta).

## Orden de implementación

1. `ConversationGate` + tests.
2. Migración `0012` + carga de `business_context`.
3. Acción `answer` en `SupportAgentService` + `SupervisorService`.
4. Wiring en `conversation.router.ts`.
5. Menú híbrido (`PollExecutor` + flujo de entrada).
6. Apellido → nombre + helper de interpolación + tono.
7. Tests de integración + `test-menu.ts`.

## Fuera de alcance (YAGNI)

- Reescritura del motor de flujos.
- IA que responda con datos fuera de `business_context` (RAG, scraping). Si no está cargado, deriva.
- Memoria conversacional larga / historial multi-turno en la IA.

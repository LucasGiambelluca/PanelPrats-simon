# BotBuilder — Especificación de Desarrollo y Receta de Reutilización

> Documento de referencia técnica del motor de flujos conversacionales (BotBuilder) usado en StockSystem.
> Objetivo: entender cómo está construido, qué hace cada nodo, y cómo reutilizarlo en otros proyectos.
>
> Última actualización: 2026-06-14

---

## 1. Resumen ejecutivo

El BotBuilder es un constructor visual de flujos conversacionales tipo *drag & drop* (estilo n8n / Typebot) que corre sobre **WhatsApp**. Se divide en dos mitades:

| Mitad | Stack | Rol |
|-------|-------|-----|
| **Editor visual** (frontend) | React + `reactflow` (`client/src/pages/BotBuilder.tsx`) | Diseñar el grafo de nodos y guardarlo como JSON en la tabla `flows` de Supabase |
| **Motor de ejecución** (backend) | TypeScript Node (`whatsapp-server/src/core/`) | Leer el JSON del flujo y ejecutarlo nodo por nodo cuando llega un mensaje |

El contrato entre ambas mitades es **un JSON de grafo** (`nodes[]` + `edges[]`). Esto es lo que hace al sistema portable: cualquier canal (WhatsApp, Telegram, web chat) puede reusar el motor si respeta ese contrato y provee un *gateway* de envío de mensajes.

```
Usuario WhatsApp
      │ mensaje
      ▼
[Gateway Baileys / Cloud API]
      │
      ▼
ConversationRouter  ── pre-clasifica, shortcuts, handover, catálogo
      │  processMessage(phone, text, ctx)
      ▼
FlowEngine  ── cola por sesión, resuelve flujo por trigger, mantiene estado
      │  executeNodeChain()
      ▼
NodeExecutorFactory.getExecutor(node.type).execute(data, context, engine)
      │
      ▼
NodeExecutionResult { messages, wait_for_input, conditionResult, updatedContext }
      │
      ▼
[Gateway] envía messages[] al usuario
```

---

## 2. Modelo de datos del flujo

### Tabla `flows` (Supabase)

| Columna | Tipo | Descripción |
|---------|------|-------------|
| `id` | uuid | PK |
| `name` | text | Nombre humano del flujo |
| `trigger_word` | text | Palabra(s) clave que disparan el flujo. CSV (`hola,menu`). `*` o vacío = catch-all |
| `nodes` | jsonb | Array de nodos del grafo (formato reactflow) |
| `edges` | jsonb | Array de conexiones entre nodos |
| `is_active` | bool | Si está apagado, el motor lo ignora |
| `created_at` | timestamp | |

### Forma de un nodo (reactflow)

```jsonc
{
  "id": "node_1775152636301_abc123",   // único; el editor genera Date.now()+random
  "type": "questionNode",               // clave registrada en NodeExecutorFactory
  "position": { "x": 250, "y": 120 },
  "data": {                             // configuración específica del nodo
    "question": "¿Tu nombre?",
    "variable": "nombre"
  }
}
```

### Forma de una arista (edge)

```jsonc
{
  "id": "e1-2",
  "source": "node_A",
  "target": "node_B",
  "sourceHandle": "true"   // OPCIONAL: usado por nodos que ramifican (condición, poll, intent...)
}
```

> **Concepto clave:** el `sourceHandle` es lo que conecta la *salida* de un nodo ramificante a un destino concreto. El motor compara el `conditionResult` (o el intent / opción elegida) contra los `sourceHandle` de las aristas que salen del nodo actual. Ver §4.3.

### Nodo de inicio

Cada flujo arranca con un nodo especial:

```jsonc
{ "id": "start", "type": "input", "data": { "label": "Inicio (Palabra Clave: Hola)" } }
```

`input` y `start` mapean al `StartNodeExecutor` (no-op que sólo deja avanzar al siguiente nodo).

---

## 3. El editor visual (`BotBuilder.tsx`)

Ubicación: `client/src/pages/BotBuilder.tsx` + `client/src/components/bot-builder/*Node.tsx`.

Responsabilidades:

1. **Registro de tipos de nodo** — `nodeTypes` mapea cada `type` string a su componente React de UI (`messageNode → MessageNode`, etc.). El componente sólo dibuja el formulario de configuración; **no ejecuta nada**.
2. **Drag & drop** — `onDrop` lee `application/reactflow` del dataTransfer y llama `addNodeByType(type, position)`. En mobile se usa `MobileNodeSelector` + FAB.
3. **Callbacks de edición** — al crear/cargar un nodo se le inyectan funciones `onChangeX` que llaman `updateNodeData(id, {campo})`. Esto mantiene el estado en React.
4. **Persistencia** — `handleSave` llama `reactFlowInstance.toObject()`, **stripea todos los callbacks `onChangeX`/`onDelete`** (no serializables) y hace `supabase.from('flows').upsert(...)`.
5. **Import / Export** — `handleExport` baja un JSON `{version, name, trigger_word, is_active, nodes, edges}`. `handleImport` lo carga como flujo nuevo sin guardar. **Este JSON es la unidad portable de un flujo.**

> ⚠️ Detalle de reutilización: antes de guardar hay que **quitar las funciones del `data`** porque `JSON.stringify` no las serializa y ensucian la fila. Al cargar (`prepareNodes`) se vuelven a inyectar. Si portás el editor, replicá este *strip + rehydrate*.

---

## 4. El motor de ejecución

### 4.1 Contrato de un executor (`core/executors/types.ts`)

Todo nodo del backend implementa esta interfaz:

```ts
interface NodeExecutor {
  execute(data, context, engine): Promise<NodeExecutionResult>;
  handleInput?(input, data, context): Promise<{ updatedContext?, messages?, isValidInput? }>;
}

interface NodeExecutionResult {
  messages: any[];              // strings o objetos (poll, image, document...) a enviar
  nextNodeId?: string | null;   // forzar siguiente nodo (raro; normalmente lo decide el edge)
  wait_for_input: boolean;      // si true, el motor para y espera respuesta del usuario
  updatedContext?: object;      // variables a mergear en la sesión
  conditionResult?: boolean|string; // resultado para ramificar (se compara con sourceHandle)
}
```

- **`execute`** corre cuando el motor *llega* al nodo (al avanzar).
- **`handleInput`** corre cuando el usuario *responde* a un nodo que estaba en `wait_for_input`. Sirve para validar/parsear la respuesta (DNI, stock, selección numérica). Si devuelve `isValidInput: false`, el nodo **no avanza** y se reenvía el prompt.

### 4.2 Registro de nodos (`NodeExecutorFactory.ts`)

Un singleton `nodeExecutorFactory` mapea `type → instancia de executor`. Si un tipo no existe, devuelve un **no-op pass-through** (avisa una vez por consola y sigue). Esto evita que un flujo viejo con un tipo borrado rompa todo.

Incluye **alias legacy**: `send_message → MessageExecutor`, `wait_input → QuestionExecutor`, `audioToTextNode`/`audioTranscriberNode → AudioToTextExecutor`, `mediaDetectorNode`/`mediaTypeDetectorNode → MediaTypeDetectorExecutor`.

### 4.3 Bucle de ejecución (`flow.engine.ts → executeNodeChain`)

```
mientras (iterations < 50):           # tope anti-loop infinito
  flow   = getFlowDefinition(flowId)  # con caché de 2 min
  node   = flow.nodes.find(id == currentNodeId)
  result = executor.execute(node.data, context, this)
  aplicar result.updatedContext a la sesión
  acumular result.messages
  si node.type == flowLinkNode: cambiar flowId, ir a 'start', continue
  si result.wait_for_input: status = waiting_input; break
  handle   = result.conditionResult                  # si ramifica
  next     = findNextNodeId(flow, currentNodeId, handle)
  si !next: status = completed; archivar sesión; break
  currentNodeId = next
```

**`findNextNodeId(flow, currentNodeId, handle)`** es el corazón del ruteo:

1. Si hay `handle`, busca una arista cuyo `sourceHandle` coincida (case-insensitive, trim).
2. Si no hay match exacto, prueba **sinónimos booleanos**:
   - Positivos: `true, yes, ok, success, centro, 1, confirmed, correcto`
   - Negativos: `false, no, fail, error, fuera de zona, fuera, 0, cancel, cancelar`
3. Si no encontró arista por handle:
   - Si el nodo **no es ramificante** (o no hubo handle) → toma la primera arista que sale (camino lineal).
   - Si el nodo **es ramificante** (`pollNode, conditionNode, locationValidatorNode, orderValidatorNode, arraySwitchNode, switchNode, keywordNode, intentResolverNode`) y el handle no matcheó → **aborta** la rama (modo estricto) para no ejecutar el camino equivocado.

### 4.4 Estado y variables (`domain/Session.ts`)

La sesión guarda variables en **3 namespaces** para evitar fugas entre flujos:

```
variables.global   → datos de la conversación (phone, pushName, chatJid, user_message...)
variables.shared    → compartidas entre todos los flujos
variables[flowId]   → privadas del flujo actual
```

- `getVariable(key)` busca primero en el namespace del flujo, luego en global.
- `getAllVariablesForCurrentFlow()` mergea `global + shared + flujo` → esto es el `context` que recibe cada executor.
- `setVariable(key, val)` escribe en el namespace del flujo actual.

La sesión se persiste en la tabla `flow_executions` (vía `SessionRepository`) y se hace **checkpoint en Redis** (`RedisPersistenceService`) tras cada mensaje. Señales transitorias (`_pendingMessages`, `_exitToAI`) se serializan dentro de `context.metadata._transient` para sobrevivir reloads.

**Interpolación de variables:** los nodos de texto reemplazan `{{nombre}}` con `context[nombre]` vía regex simple (`/\{\{(\w+)\}\}/g`). Ver `MessageExecutor`.

### 4.5 Ciclo de vida de una sesión (estados)

`active` → ejecutando nodos · `waiting_input` → esperando respuesta del usuario · `completed` → flujo terminó (se archiva) · `paused`/`HANDOVER` → humano tomó la conversación · `error` · `archived`.

### 4.6 Concurrencia (`session.queue.ts`)

Cada teléfono/sesión tiene su propia **cola FIFO** (`SessionQueue`). `FlowEngine.processMessage` encola el mensaje; se procesan secuencialmente para evitar *race conditions* si el usuario manda 3 mensajes seguidos. Las colas ociosas se eliminan del Map para no crecer sin límite.

### 4.7 El Router (`conversation.router.ts`)

Antes del motor, el `ConversationRouter` aplica prioridades:

- **P0 — Shortcuts globales** (`ShortcutsManager`): respuestas inmediatas que cortan todo.
- **P0 — Cancelar**: palabras exactas `cancelar, salir, chau, reset, reiniciar` matan la sesión.
- **P0.5 — Checkout de catálogo**: mensajes que vienen del catálogo web (parseados por `Parser.parseCatalogCheckout`) saltan directo al nodo de validación de pedido.
- **Handover**: si la conversación está en `HANDOVER`, el bot calla (salvo `hola/reset/...`).
- **Pre-scan de intención** (`IntentEngine.classify` regex; la capa IA está desactivada para ahorrar tokens).
- **P5 — Flujo activo**: si la sesión espera input, todo va al motor salvo *global breakers* (`hola, menu, cancelar...`).
- **P7 — Saludos**: fuerzan la palabra `hola` para que el motor encuentre el flujo de menú.
- **Default**: manda al motor; si no matchea ningún trigger, fallback amistoso por IA.

> El router contiene además mucha lógica de e-commerce específica (drafts, NLU de pedidos, sugerencias). **Esa parte NO es genérica del BotBuilder** — es lógica de negocio de la rotisería. Para reutilizar el motor en otro proyecto, quedate con `FlowEngine` + executors y reemplazá el router por uno simple.

---

## 5. Catálogo de nodos

Formato de cada ficha:
- **Tipo** — clave en `NodeExecutorFactory`
- **Función** — qué hace
- **Config (`data.*`)** — campos que lee
- **Salida** — qué setea en el resultado
- **handleInput** — validación de respuesta (si aplica)
- **Ramifica** — handles de salida que produce

### 5.1 Flujo / Control

#### `input` / `start` — Inicio
- **Función:** punto de entrada, no-op. Deja avanzar al siguiente nodo.
- **Salida:** `messages: []`, `wait_for_input: false`.

#### `messageNode` (alias `send_message`) — Mensaje
- **Función:** envía un texto. Interpola `{{variables}}`.
- **Config:** `data.message` o `data.text`.
- **Salida:** `messages: [texto]`, no espera input.

#### `questionNode` (alias `wait_input`) — Pregunta
- **Función:** envía una pregunta y espera la respuesta del usuario.
- **Config:** `data.question` (texto), `data.variable` (dónde guardar la respuesta), `data.allow_skip` (si ya hay valor, salta).
- **Salida:** `messages: [question]`, `wait_for_input: true`.
- La respuesta se guarda como `variable` y `variable_raw` por el motor (`handleInput` default).

#### `conditionNode` — Condición (ramifica) ⑂
- **Función:** compara una variable contra un valor y devuelve true/false.
- **Config:** `data.variable`, `data.operator` (`equals, not_equals, contains, greater_than, less_than`), `data.expectedValue`.
- **Salida:** `conditionResult: boolean`. Hace match tolerante: numérico (`"1."`, `"opción 1"`), loose-contains, índice, markdown de WhatsApp.
- **Ramifica:** aristas con `sourceHandle` `true` / `false` (o sinónimos).

#### `switchNode` — Switch por variable (ramifica) ⑂
- **Función:** compara `data.variable` contra una lista de casos.
- **Config:** `data.variable`, `data.cases` (`[{value, handle}]`), `data.default_handle`.
- **Salida:** `conditionResult: handle` del caso que matchea (o default).

#### `arraySwitchNode` — Switch sobre array (ramifica) ⑂
- **Función:** busca palabras dentro de una variable que es un array (p.ej. `split_words`).
- **Config:** `data.variable` (default `split_words`), `data.cases` (`[{value, handle}]`), `data.default_handle`.
- **Salida:** `conditionResult: handle` del primer match.

#### `keywordNode` — Keyword router (ramifica) ⑂
- **Función:** busca keywords en `user_message`/`transcripcion` y rutea.
- **Config:** `data.keywords` (`[{word, handle}]`), `data.default_handle`.
- **Salida:** `conditionResult: handle`.

#### `flowLinkNode` — Saltar a otro flujo
- **Función:** cambia la ejecución a otro flujo. **Manejado en el motor**, no en el executor.
- **Config:** `data.flowId` (flujo destino).
- **Comportamiento:** el motor setea `metadata.flowId = flowId`, va a `start` y continúa el bucle.

#### `timerNode` — Espera
- **Función:** delay bloqueante (opcional indicador "escribiendo...").
- **Config:** `data.duration` (ms, default 1000), `data.showTyping` (default true).

### 5.2 Encuestas / Selección

#### `pollNode` — Encuesta (ramifica) ⑂
- **Función:** muestra opciones numeradas; en API oficial envía botones interactivos.
- **Config:** `data.question`, `data.options` (string[]), `data.variable`/`data.contextKey` (default `poll_response`), `data.allow_skip`.
- **Salida:** `messages: [menuText]` o `[{interactive}]`, `wait_for_input: true`.
- **Resolución de respuesta** (en `flow.engine.handleInput`): matchea por número, texto exacto, parcial/fuzzy. Guarda `variable_index` y `_poll_selected_handle_<nodeId>`.
- **Ramifica:** aristas con `sourceHandle` `option-0`, `option-1`, … (índice de la opción elegida).

### 5.3 Comercio / Pedidos

> Estos nodos son específicos del dominio rotisería/e-commerce. Dependen de servicios externos (`OrderService`, `productService`, `inventoryManager`, `LocationService`) y tablas (`products`, `orders`, `draft_orders`, `catalog_items`, `shipping_zones`).

#### `catalogNode` — Mostrar menú
- **Función:** lista productos agrupados por categoría.
- **Salida:** `messages: [menú]`, `wait_for_input: true`.
- **Dep:** `productService.getProducts()`.

#### `sendCatalogNode` — Enviar link al catálogo web
- **Función:** envía un botón CTA con URL al catálogo web (autocompleta datos del cliente).
- **Config:** `data.customMessage`.
- **handleInput:** parsea el pedido devuelto por el catálogo vía `AIExtractor.analyze`; escribe `order_items`, `deliveryAddress`, `paymentMethod`.
- **Dep:** env `FRONTEND_URL`, `CATALOG_SLUG`.

#### `productSearchNode` — Buscar productos
- **Función:** busca por categoría/nombre, muestra resultados numerados.
- **Config:** `data.query`, `data.message`.
- **Salida:** `updatedContext.__last_search_results`, `wait_for_input: true`.
- **handleInput:** input numérico → selecciona y agrega a `order_items` (`isValidInput: true`); texto → nueva búsqueda (`isValidInput: false`, se queda en el nodo).
- **Dep:** `productService.findProductsByCategory / searchSimilarProducts / getEffectivePrice`.

#### `stockCheckNode` — Verificar stock
- **Función:** consulta disponibilidad y precio por nombre + cantidad.
- **Config:** `data.variable` (default `stock_result`), `data.question`.
- **handleInput:** parsea con `Parser.detectStockInquiry`/`Parser.parse`, busca producto, devuelve `{found, product_name, product_id, stock, price, requested_qty, available, total_price}`.
- **Dep:** `productService.findProduct`, `Parser`.

#### `addToCartNode` — Agregar al carrito
- **Función:** agrega el producto del `stock_result` a `order_items`; recalcula total.
- **Config:** `data.productVariable` (default `stock_result`), `data.qtyVariable` (default `cantidad`), `data.detailVariable`.
- **Salida:** `updatedContext` con nuevo `order_items`, `total_amount`, y limpia las vars usadas.

#### `clearCartNode` — Vaciar carrito
- **Config:** `data.message`.
- **Salida:** `updatedContext`: `order_items: []`, `total_amount: 0`, `location_validated: false`.

#### `orderSummaryNode` — Resumen del pedido
- **Función:** muestra el detalle línea por línea; si es checkout de catálogo, lo trae de `draft_orders`.
- **Salida:** `messages: [resumen]`, `updatedContext.total_amount`.
- **Dep:** lee `order_items`, `draft_order_id`, `shipping_cost`; query `draft_orders`.

#### `orderValidatorNode` — Confirmar pedido (ramifica) ⑂
- **Función:** muestra resumen + botones (confirmar / agregar / cancelar). Detecta retiro forzado si rechazaron delivery.
- **Config:** `data.message`.
- **handleInput:** matchea `confirmed, add_drink, add_dessert, add_more, cancel` por ID, índice numérico o sinónimos (si/confirmar→confirmed, no→cancel, agregar→add_more). Escribe `order_validation_result`.
- **Ramifica:** sobre `order_validation_result`.
- **Dep:** query `catalog_items` para botones dinámicos.

#### `createOrderNode` — Crear pedido en DB
- **Función:** persiste el pedido, valida stock, calcula envío + distancia (LocationService), dispara auto-impresión.
- **Salida:** `messages: []` (silenciado para `OrderListener`), `updatedContext.created_order`.
- **Dep:** `engine.orderService.createOrder`, `ProductService`, `LocationService`, `PrinterService.queueOrderTicket`; tablas `orders`, `draft_orders`, `whatsapp_config`, `shipping_zones`, `printer_config`.

#### `orderStatusNode` — Estado del pedido
- **Config:** `data.variable` (default `order_number`).
- **Salida:** `messages: [estado]`.
- **Dep:** query `orders` por `order_number`.

#### `slotNode` — Franjas de entrega
- **Función:** lista horarios disponibles numerados.
- **Salida:** `updatedContext._temp_slots`, `wait_for_input: true`.
- **handleInput:** valida índice numérico → `selected_slot_id`, `selected_slot_label`.
- **Dep:** `engine.slotService.getAvailableSlots`.

#### `locationValidatorNode` — Validar zona de entrega (ramifica) ⑂
- **Función:** valida la dirección/GPS contra zonas de envío (radio/polígono).
- **Config:** `data.successHandle` (default `true`), `data.failHandle` (default `FUERA DE ZONA`), `data.failNodeId`.
- **Salida:** `conditionResult: success/fail handle`; en éxito setea `shipping_zone_id`, `shipping_cost`, `distance_km`, `location_validated`, coordenadas.
- **Dep:** tabla `shipping_zones`, `GeocodingService` (Google Maps), `LocationService`, `ConfigurationService`.

### 5.4 IA / NLU

#### `groqNode` — Llamada a LLM (Groq)
- **Función:** genera respuesta con un LLM, interpolando variables.
- **Config:** `data.prompt`, `data.systemPrompt`, `data.variable`/`data.output_variable` (default `ai_response`), `data.temperature` (0.7), `data.maxTokens` (512), `data.silent`, `data.wait_for_input`.
- **Salida:** `messages` (salvo `silent`), `updatedContext[output_variable]` (respuesta limpia), `updatedContext.last_ai_completed` (true si la respuesta traía `[VOLVER_FLUJO]`).
- **Especial:** si `last_ai_completed`, el motor vuelve al nodo previo (loop conversacional con IA).
- **Dep:** Groq API vía `AIService`.

#### `intentResolverNode` — Clasificar intención (ramifica) ⑂
- **Función:** clasifica el input en uno de varios intents usando Groq, con reintentos.
- **Config:** `data.possible_intents` (CSV), `data.output_variable` (default `intent_clasificado`), `data.system_prompt`, `data.user_prompt`, `data.context_variables`, `data.fallback_message`, `data.max_retries` (2), `data.question`.
- **handleInput:** llama a Groq (temp 0.2). Si matchea → intent. Si no y quedan reintentos → `isValidInput: false` + fallback. Si se agotan → `output_variable = 'handover'`.
- **Ramifica:** sobre el intent clasificado (el motor usa ese string como handle). Valor especial `handover`.
- **Dep:** Groq API.

#### `aiAgentNode` — Agente IA de 4 pilares (ramifica) ⑂
- **Función:** wrapper del pipeline agéntico (`AgentNode`): captura → herramientas → parseo JSON → resolución contra catálogo.
- **Config:** `data.inputVariable`, `data.question`, `data.output_variable` (default `agent_intent`), `data.system_prompt`, `data.apiKey`, `data.model`.
- **Salida:** `conditionResult: respuesta` (intent en español); `updatedContext` con `agent_intent`, `_response`, `_items`, `_address`, `_delivery`, `_payment`, `_customer_name`, `_raw`, y `respuesta`.
- **Pipeline (`AgentNode`):** 1) memoria conversacional (Redis), 2) carga productos/horarios/zonas de Supabase, 3) Groq (temp 0.3, 800 tok) con recuperación de JSON a 3 intentos, 4) match de items por similitud Jaccard. Fallback por keywords si la IA falla.
- **Dep:** Groq + fallback Gemini; Supabase; Redis (`AgentMemory`).

#### `audioTranscriberNode` / `audioToTextNode` — Transcribir audio
- **Función:** descarga el audio de WhatsApp y lo transcribe.
- **Config:** `data.output_variable`/`data.variable` (default `transcripcion`).
- **Salida:** `updatedContext.transcripcion`, `updatedContext.user_message`, `updatedContext._was_audio`.
- **handleInput:** rechaza `_MEDIA_RECEIVED_` (espera audio real).
- **Dep:** Axios (descarga), `AIService.transcribe` (Groq audio), `context._receivedFile.url`.

#### `mediaTypeDetectorNode` / `mediaDetectorNode` — Detectar tipo de media (ramifica) ⑂
- **Función:** detecta si el mensaje es audio/text/image/location y rutea.
- **Config:** `data.output_variable` (default `media_type`), `data.audio_handle` (default `audio`), `data.text_handle` (default `text`).
- **Salida:** `conditionResult: audio|text|image|location|file|unknown`; flags `_is_audio`, `_is_text`, `_transcription`.
- **Dep:** WhatsApp inyecta `context._isAudio`, `_receivedFile`, `_location`, `_transcription`.

#### `bufferMemoryNode` — Cargar memoria conversacional
- **Función:** carga el historial reciente desde Redis al contexto (para que la IA tenga contexto).
- **Config:** `data.capacity` (default 10).
- **Salida:** `updatedContext.ai_memory_stack`, `_history_loaded`, `_memory_capacity`.
- **Dep:** Redis (`redisPersistence`), `context.phone`.

#### `textSplitterNode` — Partir texto en palabras
- **Función:** parte un texto en palabras minúsculas sin puntuación → array.
- **Config:** `data.source_variable` (default `transcripcion`, fallback `user_message`), `data.target_variable` (default `split_words`).
- **Salida:** `updatedContext[target_variable]`.

### 5.5 Media / Documentos

#### `mediaUploadNode` — Recibir archivo
- **Función:** guarda la URL del archivo recibido en una variable, o lo pide.
- **Config:** `data.variable` (default `file_url`), `data.message`.
- **Salida:** `wait_for_input: true` si no hay archivo; al recibir, guarda URL y limpia `_receivedFile`.

#### `sendMediaNode` — Enviar media
- **Función:** envía imagen o documento con caption (interpola `{{}}`).
- **Config:** `data.mediaType` (`image`/`document`), `data.mediaUrl`, `data.caption`, `data.mimetype` (default `application/pdf`), `data.fileName` (default `documento.pdf`).
- **Salida:** `messages: [{image|document...}]`.

#### `documentNode` — Generar PDF del pedido
- **Función:** genera y envía el comprobante PDF del pedido.
- **Salida:** 2 mensajes (texto + documento con buffer PDF).
- **Dep:** `PdfService.generateOrderReceipt`; lee `created_order`, `order_items`, fecha, dirección.

### 5.6 Operaciones / Humanos

#### `handoverNode` — Transferir a humano
- **Función:** pausa el bot y marca la conversación para atención humana.
- **Config:** `data.message` (interpola `{{}}`).
- **Salida:** `messages: [msg]`, `wait_for_input: true`.
- **Efecto:** `flow_executions.status = 'HANDOVER'`, `whatsapp_conversations.status = 'HANDOVER'`. El front la mueve a la pestaña de Atención.

#### `threadNode` — Gestionar estado de conversación
- **Función:** transiciona estado (HANDOVER ↔ RESUME).
- **Config:** `data.action` (`HANDOVER`/`RESUME`, default HANDOVER), `data.message`, `data.nextId`.
- **Efecto:** actualiza `whatsapp_conversations` y `flow_executions`.

#### `businessHoursNode` — Horario comercial (ramifica) ⑂
- **Función:** evalúa si el momento actual está dentro del horario (timezone, turnos, feriados, cutoff).
- **Config (de tabla `whatsapp_config.business_hours`):** `isActive`, `days[]`, `startTime`/`endTime`, `shifts[]`, `timezone` (default Buenos Aires), `specialClosures[]`, `cutoffMinutes`.
- **Salida:** `conditionResult: true` (abierto) / `false` (cerrado). *Fail-open* ante error de DB.
- **Ramifica:** `true`/`false`.

#### `reportNode` — Crear reclamo
- **Función:** crea un registro de reclamo y confirma.
- **Config:** `data.variable` (default `claim_description`), `data.reportType` (default `reclamo`), `data.priority` (default `medium`), `data.text`.
- **Dep:** tablas `clients`, `claims`.

#### `webhookNode` — Disparador por webhook
- **Función:** nodo de entrada para flujos disparados por webhook externo. Inyecta el mensaje al contexto.
- **Salida:** `updatedContext.webhook_raw_message`, `webhook_timestamp`.
- **Especial:** el motor prioriza este nodo como punto de arranque si el flujo lo tiene (ver `flow.engine` *DYNAMIC START NODE*).

---

## 6. Receta: cómo reutilizar el BotBuilder en otro proyecto

### Paso 1 — Decidir qué llevás
- **Núcleo portable:** `FlowEngine`, `NodeExecutorFactory`, `Session`, `SessionQueue`, los executors **genéricos** (message, question, condition, switch, poll, timer, handover, flowLink, start), e interfaz `NodeExecutor`.
- **No portable tal cual:** todo lo de comercio (catalog, order*, stock, slot, location) y el `ConversationRouter` (es lógica de rotisería). Reescribilos según tu dominio.

### Paso 2 — Definir el contrato JSON
Reusá el formato reactflow (`nodes[]` + `edges[]` con `sourceHandle`). Es lo que hace portable el editor y el motor.

### Paso 3 — Implementar el gateway
El motor produce `messages[]` (strings u objetos). Necesitás un *adapter* que los envíe por tu canal (Baileys, Cloud API, Telegram, web). Ver `core/gateway/whatsapp.interface.ts` + `baileys.adapter.ts` como modelo.

### Paso 4 — Persistencia
- Tabla `flows` (definiciones).
- Tabla `flow_executions` (estado de sesión) + Redis para checkpoints.
- Si no usás Supabase, abstraé `SessionRepository` y `getFlowDefinition`.

### Paso 5 — Agregar un nodo nuevo (procedimiento)
1. **Backend:** crear `MiNodoExecutor.ts` implementando `NodeExecutor`. Registrarlo en `NodeExecutorFactory` con su `type`.
2. **Frontend:** crear `MiNodo.tsx` (UI del formulario) y registrarlo en `nodeTypes` de `BotBuilder.tsx` + agregar defaults en `addNodeByType` y al `Sidebar`/`MobileNodeSelector`.
3. **Si ramifica:** devolver `conditionResult` y documentar los `sourceHandle` que tu nodo emite, para que el diseñador los conecte.
4. **Si espera respuesta:** implementar `handleInput` y devolver `wait_for_input: true` en `execute`.

### Paso 6 — Reglas de oro
- Un nodo **nunca** envía mensajes por sí mismo: devuelve `messages[]` y el gateway envía.
- Estado **siempre** vía `updatedContext` (el motor lo mergea y persiste). No mutar la sesión directamente.
- Ramificación **siempre** vía `conditionResult` + `sourceHandle`. No hardcodear `nextNodeId` salvo casos especiales (flowLink, handover con `nextId`).
- Strip de callbacks antes de guardar el JSON del editor; rehidratación al cargar.
- Tope de iteraciones (50) para evitar loops infinitos.

---

## 7. Mapa de archivos clave

```
client/src/pages/BotBuilder.tsx                  Editor visual (grafo, save/load/import/export)
client/src/components/bot-builder/*Node.tsx      UI de cada nodo
client/src/components/bot-builder/Sidebar.tsx    Paleta de nodos (desktop)
client/src/components/bot-builder/MobileNodeSelector.tsx  Paleta (mobile)

whatsapp-server/src/core/engine/flow.engine.ts        Motor: bucle, ruteo, triggers, caché
whatsapp-server/src/core/engine/conversation.router.ts Router: prioridades, handover, e-commerce
whatsapp-server/src/core/engine/session.queue.ts      Cola FIFO por sesión
whatsapp-server/src/core/executors/types.ts           Interfaz NodeExecutor + NodeExecutionResult
whatsapp-server/src/core/executors/NodeExecutorFactory.ts  Registro type→executor
whatsapp-server/src/core/executors/*Executor.ts       Lógica de cada nodo
whatsapp-server/src/core/domain/Session.ts            Estado + namespaces de variables
whatsapp-server/src/core/agent/AgentNode.ts           Pipeline IA de 4 pilares
whatsapp-server/src/core/gateway/baileys.adapter.ts   Adapter de envío WhatsApp
```

---

## 8. Tabla resumen de nodos

| Tipo | Categoría | Ramifica | Espera input | Dep externa |
|------|-----------|:--------:|:------------:|-------------|
| `input`/`start` | Control | — | — | — |
| `messageNode` | Mensaje | — | — | — |
| `questionNode` | Mensaje | — | ✓ | — |
| `conditionNode` | Control | ✓ (true/false) | — | — |
| `switchNode` | Control | ✓ (case handle) | — | — |
| `arraySwitchNode` | Control | ✓ (case handle) | — | — |
| `keywordNode` | Control | ✓ (keyword handle) | — | — |
| `flowLinkNode` | Control | — (cambia flujo) | — | — |
| `timerNode` | Control | — | — | — |
| `pollNode` | Selección | ✓ (option-N) | ✓ | API oficial (botones) |
| `catalogNode` | Comercio | — | ✓ | productService |
| `sendCatalogNode` | Comercio | — | ✓ | AIExtractor, env |
| `productSearchNode` | Comercio | — | ✓ | productService |
| `stockCheckNode` | Comercio | — | ✓ | productService, Parser |
| `addToCartNode` | Comercio | — | — | — |
| `clearCartNode` | Comercio | — | — | — |
| `orderSummaryNode` | Comercio | — | — | draft_orders |
| `orderValidatorNode` | Comercio | ✓ (confirmed/...) | ✓ | catalog_items |
| `createOrderNode` | Comercio | — | — | OrderService, Printer, LocationService |
| `orderStatusNode` | Comercio | — | — | orders |
| `slotNode` | Comercio | — | ✓ | slotService |
| `locationValidatorNode` | Comercio | ✓ (zona ok/fail) | — | shipping_zones, Geocoding |
| `groqNode` | IA | — | opt | Groq |
| `intentResolverNode` | IA | ✓ (intent) | ✓ | Groq |
| `aiAgentNode` | IA | ✓ (intent es) | — | Groq+Gemini, Supabase, Redis |
| `audioTranscriberNode` | IA | — | ✓ | Groq audio, Axios |
| `mediaTypeDetectorNode` | IA | ✓ (audio/text/...) | — | WhatsApp media |
| `bufferMemoryNode` | IA | — | — | Redis |
| `textSplitterNode` | IA | — | — | — |
| `mediaUploadNode` | Media | — | ✓ | — |
| `sendMediaNode` | Media | — | — | — |
| `documentNode` | Media | — | — | PdfService |
| `handoverNode` | Operación | — | ✓ | whatsapp_conversations |
| `threadNode` | Operación | — | — | whatsapp_conversations |
| `businessHoursNode` | Operación | ✓ (true/false) | — | whatsapp_config |
| `reportNode` | Operación | — | — | claims, clients |
| `webhookNode` | Operación | — | — | — (start dinámico) |
```

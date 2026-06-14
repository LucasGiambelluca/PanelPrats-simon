# Panel WhatsApp Multi-Cuenta con Bot Builder Visual — Diseño

> Fecha: 2026-06-14
> Estado: aprobado para escribir plan de implementación
> Base de reutilización: `C:/Users/Lucas/Desktop/Sotcksystem` (sistema rotisería) — ver `BOTBUILDER-SPEC.md`

## 1. Resumen ejecutivo

Panel para recibir y responder mensajes de **WhatsApp** desde **varios números** (multi-cuenta), con un **bot builder visual estilo n8n** para crear flujos de atención. Se construye portando el **núcleo genérico** del sistema rotisería (StockSystem) y descartando toda la lógica de comercio.

Tres piezas:
- **`server/`** — backend Node TypeScript: gateway Baileys multi-instancia, motor de flujos (FlowEngine), executors genéricos, router simple, API REST.
- **`client/`** — frontend React + Vite: bot builder visual, inbox de conversaciones, gestión de cuentas WhatsApp, login.
- **`supabase/`** — migraciones SQL con schema multi-cuenta.

Decisiones tomadas en brainstorming:
- **Multi-cuenta** (N números en UN solo proceso, aislados por `account_id`). NO multi-tenant SaaS completo.
- **Persistencia**: Supabase (Postgres) + Redis (checkpoints de sesión) — igual que el origen, máximo reuso.
- **Nodos**: todos los genéricos + IA/NLU + Media + Operaciones. Sin nodos de comercio.
- **Auth**: login con usuarios vía Supabase Auth; cada usuario ve sus cuentas.
- **Estrategia**: scaffold nuevo + copia selectiva del núcleo portable (no copia-total-strip, no monorepo compartido).

## 2. Arquitectura

### 2.1 Cambio central: un-bot-por-proceso → N-cuentas-en-un-proceso

El sistema origen corre **un container por tenant** (`BOT_ID` en env, un singleton Baileys, claves Redis `bot:${botId}:`). El panel nuevo corre **un solo proceso** con un **`AccountManager`** que mantiene un `Map<account_id, BaileysClient>`.

```
                    ┌─────────── server (1 proceso) ───────────┐
WhatsApp nº1 ──┐    │  AccountManager                          │
WhatsApp nº2 ──┼───▶│   ├─ BaileysClient(acc_1) ─┐             │
WhatsApp nº3 ──┘    │   ├─ BaileysClient(acc_2) ─┼─▶ Router ─▶ │
                    │   └─ BaileysClient(acc_3) ─┘   (genérico)│
                    │                                 ▼         │
                    │                            FlowEngine ───┼──▶ Supabase + Redis
                    └──────────────────────────────────────────┘   (todo con account_id)
```

### 2.2 Aislamiento por `account_id`

- **Auth Baileys**: carpeta por cuenta en filesystem `./auth/{account_id}/` (multi-file auth state). NO en DB.
- **Redis checkpoint**: clave `checkpoint:{account_id}:{phone}` (origen usa `checkpoint:{phone}`).
- **Queries Supabase**: toda lectura/escritura filtra `.eq('account_id', accountId)`.
- **Etiquetado**: el `BaileysClient` de cada cuenta etiqueta el mensaje entrante con su `account_id` antes de pasarlo al router.
- **Resiliencia**: una cuenta que crashea no afecta a las demás.

### 2.3 Monorepo

```
nuevo-panel/
├── server/          # backend Node TS
├── client/          # frontend React + Vite
└── supabase/        # migraciones SQL
```

## 3. Componentes

### 3.1 Backend (`server/`)

| Módulo | Origen | Cambio |
|--------|--------|--------|
| `AccountManager` | **nuevo** (envuelve `WhatsAppClient`) | Map de clientes Baileys por `account_id`; lifecycle connect/disconnect/QR/status |
| `BaileysClient` | `infrastructure/whatsapp/WhatsAppClient.ts` | singleton → instancia por cuenta; auth dir + Redis namespaced |
| `FlowEngine` | `core/engine/flow.engine.ts` | +`accountId` en firma y queries |
| `SessionQueue` | `core/engine/session.queue.ts` | igual; key por `account:phone` |
| `ConversationRouter` | `core/engine/conversation.router.ts` | **reescrito simple**, sin comercio |
| `NodeExecutorFactory` + executors | `core/executors/*` | portar genéricos+IA+media+ops; tirar comercio |
| `Session` | `core/domain/Session.ts` | igual (3 namespaces: global/shared/flowId) |
| `SessionRepository` | `infrastructure/repositories/SessionRepository.ts` | +`account_id` |
| `RedisPersistenceService` | `infrastructure/persistence/RedisPersistenceService.ts` | key `checkpoint:{account}:{phone}` |
| API REST | `api/` | `/accounts` (CRUD+QR+status), `/flows`, `/conversations`, `/messages/send` |

**Executors a portar** (genéricos + IA + media + ops):
`start`/`input`, `messageNode`, `questionNode`, `conditionNode`, `switchNode`, `arraySwitchNode`, `keywordNode`, `flowLinkNode`, `timerNode`, `pollNode`, `groqNode`, `intentResolverNode`, `aiAgentNode`, `audioTranscriberNode`, `mediaTypeDetectorNode`, `bufferMemoryNode`, `textSplitterNode`, `mediaUploadNode`, `sendMediaNode`, `documentNode`, `handoverNode`, `threadNode`, `businessHoursNode`, `reportNode`, `webhookNode`.

**Executors a descartar** (comercio rotisería):
`catalogNode`, `sendCatalogNode`, `productSearchNode`, `stockCheckNode`, `addToCartNode`, `clearCartNode`, `orderSummaryNode`, `orderValidatorNode`, `createOrderNode`, `orderStatusNode`, `slotNode`, `locationValidatorNode`.

**Dependencias backend** (de `whatsapp-server/package.json`): `@whiskeysockets/baileys` ^6.7.0, `@supabase/supabase-js`, `ioredis`, `express`, `cors`, `dotenv`, `pino`, `qrcode`, `qrcode-terminal`, `zod`, `axios`, `date-fns`, `async-mutex`. IA: `@google/generative-ai` (fallback Gemini) + Groq vía HTTP. Dev: `vitest`, `ts-node`, `typescript`, `@types/*`.

### 3.2 Frontend (`client/`)

| Página | Origen | Cambio |
|--------|--------|--------|
| `Login` + `AuthContext` | `pages/Login.tsx`, `context/AuthContext.tsx` | Supabase Auth tal cual |
| `Accounts` (lista cuentas WA) | **nuevo** | conectar/desconectar número, ver estado |
| `WhatsAppConnect` (QR) | `pages/WhatsAppConnect.tsx` | simplificar a Baileys QR/pairing por cuenta (sacar GREEN-API/WAHA/Evolution/Meta embedded) |
| `WhatsAppInbox` | `pages/WhatsAppInbox.tsx` + `hooks/useWhatsAppInbox.ts` | sacar `parseOrderFromText`/convert-to-order; filtrar por `account_id`; selector de cuenta activa |
| `BotBuilder` + `*Node.tsx` | `pages/BotBuilder.tsx`, `components/bot-builder/*` | sacar nodos comercio del palette; defaults genéricos (no "rotisería"); flows con `account_id` |

**Stack frontend** (de `client/package.json`): React 19, Vite 7, TypeScript 5.9, Tailwind 3.4, `reactflow` 11.11, `@supabase/supabase-js`, `react-router-dom` 7, `zustand`, `lucide-react`, `sonner`, `@dnd-kit/*`. Sacar: `recharts`, `jspdf`, `xlsx`, `leaflet` (solo si no se usan en lo portado).

**Componentes bot-builder a portar** (UI de nodos, todos en `components/bot-builder/`): `MessageNode`, `QuestionNode`, `ConditionNode`, `SwitchNode`, `PollNode`, `KeywordNode`, `ArraySwitchNode`, `MediaUploadNode`, `MediaTypeDetectorNode`, `SendMediaNode`, `AudioTranscriberNode`, `TextSplitterNode`, `FlowLinkNode`, `ThreadNode`, `TimerNode`, `HandoverNode`, `GroqNode`, `AIAgentNode`, `IntentResolverNode`, `BufferMemoryNode`, `DocumentGeneratorNode`, `WebhookNode`, `ReportNode`, `BusinessHoursNode`. Sacar: `CatalogNode`, `StockCheckNode`, `AddToCartNode`, `OrderSummaryNode`, `OrderValidatorNode`, `CreateOrderNode`, `OrderStatusNode`, `SendCatalogNode`, `ProductSearchNode`, `ClearCartNode`, `LocationValidatorNode`.

## 4. Flujo de datos

```
WhatsApp nº (cuenta X)
  ▼ messages.upsert
BaileysClient(X) ── normaliza phone, detecta tipo (text/audio/img/loc), etiqueta accountId=X
  ▼ guarda msg INBOUND en whatsapp_messages (account_id=X)
ConversationRouter.processMessage(X, phone, text, ctx)
  ├─ P0 cancelar (cancelar/salir/reset/reiniciar/chau) → forceReset
  ├─ P1 shortcuts globales
  ├─ handover? (status HANDOVER) → bot calla
  ├─ saludo (hola/menu/menú/inicio) → fuerza flujo menú
  └─ default → FlowEngine
       ▼ processMessage(X, phone, text, ctx)
     SessionQueue(X:phone) FIFO
       ▼ carga sesión (Redis checkpoint X → Supabase fallback)
     resuelve flow por trigger (flows WHERE account_id=X, cache 2min)
       ▼ executeNodeChain (tope 50 iteraciones)
     executor.execute → {messages, wait_for_input, conditionResult, updatedContext}
       ▼ findNextNodeId (handle + sinónimos booleanos)
       ▼ persiste sesión (Supabase flow_executions + Redis checkpoint X)
  ▼ messages[]
BaileysClient(X).send ── anti-ban (mutex, typing 1-3s, delay 2-5s)
  ▼ guarda OUTBOUND
Frontend Inbox ── Supabase realtime (filtrado account_id) refresca chat
```

Reglas de oro (del spec origen, se mantienen):
- Un nodo nunca envía mensajes solo: devuelve `messages[]`, el gateway envía.
- Estado siempre vía `updatedContext` (el motor mergea + persiste).
- Ramificación siempre vía `conditionResult` + `sourceHandle`.
- Strip de callbacks antes de guardar el JSON del editor; rehidratación al cargar.

## 5. Schema de base de datos (multi-cuenta)

Tabla nueva `accounts` + columna `account_id` en todas las tablas portables.

```sql
-- NUEVA
CREATE TABLE accounts (
  id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name         text NOT NULL,
  phone_number text,
  status       text NOT NULL DEFAULT 'disconnected'
                 CHECK (status IN ('disconnected','connecting','qr','connected')),
  session_path text,
  qr_code      text,
  created_at   timestamptz DEFAULT now(),
  updated_at   timestamptz DEFAULT now()
);

-- AGREGAR account_id NOT NULL a:
--   flows, flow_executions, whatsapp_conversations,
--   flow_executions_history
-- whatsapp_messages hereda cuenta vía conversation_id (cascade)

-- Índices compuestos:
--   flows (account_id, trigger_word) WHERE is_active
--   flow_executions (account_id, phone, status)
--   whatsapp_conversations (account_id, phone)
```

Tablas portadas (origen): `flows`, `flow_executions` (+`session_id`, `version`, `global_variables`, `expires_at`), `whatsapp_conversations` (status BOT/HANDOVER), `whatsapp_messages` (direction INBOUND/OUTBOUND, message_type text/image/audio/document), `flow_executions_history`, `flow_logs`, `audit_logs`.

**Auth Baileys**: NO en DB. En filesystem `./auth/{account_id}/` (multi-file state de Baileys).

**RLS**: políticas por `user_id` de la cuenta — cada usuario ve solo sus `accounts` y, vía join, sus flows/conversaciones/mensajes. El backend usa `SUPABASE_SERVICE_KEY` (bypassa RLS); el frontend usa `ANON_KEY` (sujeto a RLS).

## 6. Manejo de errores

- **Executor desconocido** → no-op pass-through (no rompe flows viejos con tipos borrados; avisa 1 vez por consola).
- **Loop infinito** → tope 50 iteraciones en `executeNodeChain`.
- **Desconexión Baileys** → backoff exponencial 3s→30s, máx 10 intentos. Logout (statusCode 401) → limpia auth de esa cuenta, regenera QR, marca `accounts.status='qr'`.
- **businessHours / error de DB** → fail-open (no bloquea).
- **Redis caído** → fallback a Supabase (fuente autoritativa de sesión).
- **Aislamiento de cuentas** → un `BaileysClient` que falla no tumba el proceso ni las otras cuentas (try/catch por instancia en `AccountManager`).

## 7. Testing

- **Framework**: Vitest (ya presente en el origen).
- **Portar**: `core/executors/__tests__`, `core/engine/__tests__`, `core/domain/__tests__` (los de executors genéricos; descartar los de comercio).
- **Tests nuevos clave**:
  - `AccountManager`: aislamiento entre cuentas (mensaje de cuenta A no contamina sesión de cuenta B; Redis keys namespaced; auth dirs separados).
  - `ConversationRouter` simple: cancelar / saludo / handover / trigger / default.
  - `FlowEngine` con `accountId`: resuelve flow correcto por cuenta.

## 8. Variables de entorno

**server/.env**:
```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
REDIS_URL=redis://127.0.0.1:6379
AUTH_BASE_PATH=./auth
GROQ_API_KEY=            # opcional, nodos IA
GOOGLE_GENERATIVE_AI_KEY= # opcional, fallback Gemini
PORT=3001
CORS_ORIGIN=http://localhost:5173
```

**client/.env**:
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:3001
```

## 9. Fuera de alcance (YAGNI)

- Multi-tenant SaaS completo (deploy aislado por cliente, billing, orgs).
- Nodos y servicios de comercio (orders, stock, catálogo, cadetes, cocina, slots, geocoding, impresión).
- Providers WhatsApp alternativos (GREEN-API, WAHA, Evolution, Meta Cloud embedded signup). Solo Baileys.
- Convert-to-order y parsing de pedidos en el inbox.

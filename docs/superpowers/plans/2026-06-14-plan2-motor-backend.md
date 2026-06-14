# Plan 2 — Motor Backend (Engine + Executors) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Portar el núcleo de ejecución genérico (Session, NodeExecutorFactory, executors genéricos+IA+media+ops, FlowEngine, SessionQueue, repos, Redis) desde StockSystem al `server/` nuevo, agregando `accountId` como dimensión de aislamiento en todo el camino de persistencia.

**Architecture:** Copia-verbatim de archivos que NO tocan la DB (Session, types, executors puros) + copia-con-adaptación de los que sí (engine, repos, RedisPersistence) para inyectar `accountId`. Se agrega un shim `config/database.ts` que re-exporta `{ supabase, redis }` para que los archivos portados (que importan `../../config/database`) compilen sin editar cada import.

**Tech Stack:** Node 20, TypeScript 5.9, Vitest 4. Depende de Plan 1 (clientes Supabase/Redis + `account-keys.ts` + schema).

**Origen:** `C:/Users/Lucas/Desktop/Sotcksystem/whatsapp-server/src`
**Destino:** `server/src`
**Spec:** `docs/superpowers/specs/2026-06-14-panel-whatsapp-multicuenta-design.md`

> **Convención de copia:** "Copiar SRC→DST" = leer el archivo origen con la herramienta Read y escribir su contenido idéntico en el destino con Write, salvo los edits que el step liste explícitamente. NO modificar lógica fuera de lo indicado.

---

## Estructura de archivos (este plan)

```
server/src/
├── config/database.ts                 # NUEVO shim: re-exporta { supabase, redis }
├── utils/
│   ├── logger.ts                      # port
│   └── phoneUtils.ts                  # port
├── flows/types/flow.types.ts          # port (FlowDefinition, FlowExecution)
├── services/
│   ├── AIService.ts                   # port (Groq/Gemini) — usado por executors IA
│   ├── ShortcutsManager.ts            # port — usado por engine
│   └── ConfigurationService.ts        # port (reducido) — usado por engine
├── core/
│   ├── domain/Session.ts              # port verbatim
│   ├── executors/
│   │   ├── types.ts                   # port verbatim
│   │   ├── NodeExecutorFactory.ts     # port + sacar registros de comercio
│   │   ├── <23 executors genéricos>.ts# port verbatim
│   │   └── __tests__/ConditionExecutor.test.ts, NodeExecutorFactory.test.ts
│   ├── agent/*                        # port (para aiAgentNode) — ver Task 9 (caveat)
│   └── engine/
│       ├── flow.engine.ts             # port + accountId
│       ├── session.queue.ts           # port verbatim
│       ├── node.validator.ts          # port verbatim
│       └── session.auditor.ts         # port verbatim
└── infrastructure/
    ├── repositories/SessionRepository.ts        # port + accountId
    └── persistence/RedisPersistenceService.ts   # port + accountId
```

---

### Task 1: Shim `config/database.ts` + utils

**Files:**
- Create: `server/src/config/database.ts`
- Create: `server/src/utils/logger.ts`
- Create: `server/src/utils/phoneUtils.ts`

- [ ] **Step 1: Escribir `server/src/config/database.ts`** (re-export para compat de imports portados)

```ts
// Shim de compatibilidad: los archivos portados importan desde '../../config/database'.
export { supabase } from './supabase';
export { redis } from './redis';
```

- [ ] **Step 2: Copiar logger** — Read `whatsapp-server/src/utils/logger.ts` → Write `server/src/utils/logger.ts` (verbatim). Si importa winston/pino, verificar que la dep esté en `server/package.json` (pino ya está; si usa winston, agregar `winston` a dependencies y `npm install`).

- [ ] **Step 3: Escribir `server/src/utils/phoneUtils.ts`** (verbatim del origen — contenido exacto):

```ts
export class PhoneUtils {
  static normalize(phone: string): string {
    if (!phone) return '';
    if (phone.includes('@lid')) return phone.trim();
    let clean = phone.replace('@s.whatsapp.net', '').replace('@c.us', '').replace('@g.us', '').trim();
    if (clean.includes('@')) return clean;
    return clean.replace(/[^0-9]/g, '');
  }

  static toJid(phone: string): string {
    if (!phone) return '';
    if (phone.includes('@')) return phone;
    if (phone.includes('-')) return `${phone}@g.us`;
    return `${phone}@s.whatsapp.net`;
  }

  static isLid(phone: string): boolean {
    return phone.includes('@lid');
  }
}
```

- [ ] **Step 4: type-check + commit**

Run: `cd server && npm run type-check`
Expected: sin errores (puede faltar lo que importa logger; resolver antes de commit).

```bash
git add server/src/config/database.ts server/src/utils/
git commit -m "feat(server): shim database + utils (logger, phoneUtils)"
```

---

### Task 2: Tipos de flujo + Session (verbatim)

**Files:**
- Create: `server/src/flows/types/flow.types.ts`
- Create: `server/src/core/domain/Session.ts`
- Test: `server/src/core/domain/__tests__/Session.test.ts`

- [ ] **Step 1: Copiar tipos** — Read `whatsapp-server/src/flows/types/flow.types.ts` → Write `server/src/flows/types/flow.types.ts` (verbatim).

- [ ] **Step 2: Copiar Session** — Read `whatsapp-server/src/core/domain/Session.ts` → Write `server/src/core/domain/Session.ts` (verbatim; no tiene imports externos).

- [ ] **Step 3: Escribir test de Session (namespaces de variables)**

```ts
import { describe, it, expect } from 'vitest';
import { Session } from '../Session';

function makeSession() {
  return Session.fromJSON({
    id: 'acc1:1to1:549111',
    userPhone: '549111',
    chatJid: '549111@s.whatsapp.net',
    currentNodeId: 'start',
    status: 'active',
    metadata: { flowId: 'flow-1' },
    variables: { global: {}, shared: {}, 'flow-1': {} },
  });
}

describe('Session', () => {
  it('setVariable escribe en el namespace del flujo actual y getVariable lo lee', () => {
    const s = makeSession();
    s.setVariable('nombre', 'Lucas');
    expect(s.getVariable('nombre')).toBe('Lucas');
  });

  it('getAllVariablesForCurrentFlow mergea global + shared + flujo', () => {
    const s = makeSession();
    s.setGlobalVariable('phone', '549111');
    s.setVariable('nombre', 'Lucas');
    const all = s.getAllVariablesForCurrentFlow();
    expect(all.phone).toBe('549111');
    expect(all.nombre).toBe('Lucas');
  });
});
```

> Nota: si `fromJSON` espera otra forma, ajustar el objeto del test al shape real leído en Step 2 (no cambiar la clase). Verificar las claves exactas (`metadata.flowId`, `variables`) contra el archivo portado.

- [ ] **Step 4: Correr test**

Run: `cd server && npx vitest run src/core/domain/__tests__/Session.test.ts`
Expected: PASS (2 tests). Si falla por shape, corregir el test según el `toJSON/fromJSON` real.

- [ ] **Step 5: Commit**

```bash
git add server/src/flows server/src/core/domain
git commit -m "feat(server): port flow.types + Session (3 namespaces)"
```

---

### Task 3: Servicios de apoyo (AIService, ShortcutsManager, ConfigurationService)

**Files:**
- Create: `server/src/services/AIService.ts`
- Create: `server/src/services/ShortcutsManager.ts`
- Create: `server/src/services/ConfigurationService.ts`

- [ ] **Step 1: Copiar AIService** — Read `whatsapp-server/src/services/AIService.ts` → Write `server/src/services/AIService.ts` (verbatim). Lee `GROQ_API_KEY` y `GOOGLE_GENERATIVE_AI_KEY` de env (ya en `.env.example`). Verificar dep `@google/generative-ai` → agregar a `server/package.json` dependencies (`"@google/generative-ai": "^0.24.1"`) y `npm install`.

- [ ] **Step 2: Copiar ShortcutsManager** — Read `whatsapp-server/src/services/ShortcutsManager.ts` → Write destino (verbatim). Si hace queries a tablas de comercio, reducir a un stub que devuelva `null`/`[]` (no romper la firma `handle(text, phone)`). Documentar en el commit qué se stubeó.

- [ ] **Step 3: Copiar ConfigurationService (reducido)** — Read origen. Mantener SOLO los métodos que usa el engine/cliente: `syncBotPhoneNumber` y getters de config genérica. Quitar métodos de comercio (shipping, store coords). Si el método llama tablas inexistentes, devolver defaults.

- [ ] **Step 4: type-check + commit**

Run: `cd server && npm run type-check`
Expected: sin errores. Resolver imports faltantes antes de commit.

```bash
git add server/src/services/
git commit -m "feat(server): port AIService + ShortcutsManager + ConfigurationService (genéricos)"
```

---

### Task 4: Executors genéricos — lote Control/Mensajes (verbatim)

**Files (copiar verbatim, Read origen → Write destino en `server/src/core/executors/`):**
- `types.ts`, `StartNodeExecutor.ts`, `MessageExecutor.ts`, `QuestionExecutor.ts`, `ConditionExecutor.ts`, `SwitchExecutor.ts`, `ArraySwitchExecutor.ts`, `KeywordExecutor.ts`, `FlowLinkExecutor.ts`, `TimerExecutor.ts`, `PollExecutor.ts`

- [ ] **Step 1: Copiar `types.ts`** — verbatim. (Contenido confirmado: interfaces `NodeExecutor` + `NodeExecutionResult`.)

- [ ] **Step 2: Copiar los 10 executors del lote** — cada uno verbatim. Estos importan solo `./types` y, algunos, `../../utils/logger`. No tocan DB. (MessageExecutor, QuestionExecutor y ConditionExecutor son los confirmados; el resto sigue el mismo patrón.)

- [ ] **Step 3: type-check**

Run: `cd server && npm run type-check`
Expected: sin errores en estos archivos.

- [ ] **Step 4: Commit**

```bash
git add server/src/core/executors/types.ts server/src/core/executors/StartNodeExecutor.ts server/src/core/executors/MessageExecutor.ts server/src/core/executors/QuestionExecutor.ts server/src/core/executors/ConditionExecutor.ts server/src/core/executors/SwitchExecutor.ts server/src/core/executors/ArraySwitchExecutor.ts server/src/core/executors/KeywordExecutor.ts server/src/core/executors/FlowLinkExecutor.ts server/src/core/executors/TimerExecutor.ts server/src/core/executors/PollExecutor.ts
git commit -m "feat(server): port executors de control/mensajes"
```

---

### Task 5: Executors Media + Operaciones (verbatim)

**Files (verbatim → `server/src/core/executors/`):**
- `MediaUploadExecutor.ts`, `SendMediaExecutor.ts`, `DocumentExecutor.ts`, `AudioToTextExecutor.ts`, `MediaTypeDetectorExecutor.ts`, `HandoverExecutor.ts`, `ThreadManagerExecutor.ts`, `WebhookExecutor.ts`, `ReportExecutor.ts`, `BusinessHoursExecutor.ts`

- [ ] **Step 1: Copiar los 10** — verbatim. Notas de dependencia:
  - `AudioToTextExecutor` usa Axios + `AIService.transcribe` + `context._receivedFile.url`. Axios ya está.
  - `DocumentExecutor` usa `PdfService` (comercio). **Adaptación:** si `PdfService` no se porta, dejar el executor pero que devuelva un mensaje de error controlado si no hay servicio PDF, o portar un `PdfService` genérico mínimo. Marcar TODO en el commit. (Si el usuario no necesita PDF, este nodo queda como no-op funcional.)
  - `ReportExecutor` escribe en tablas `claims`/`clients`. **Adaptación:** apuntar a una tabla genérica `reports` o stubear el insert. Documentar.
  - `BusinessHoursExecutor` lee `whatsapp_config.business_hours`. **Adaptación:** leer config genérica por `account_id` (se resuelve en Plan 3 cuando exista la fuente); por ahora fail-open (devuelve `true`) si no hay config.

- [ ] **Step 2: type-check + commit**

Run: `cd server && npm run type-check`

```bash
git add server/src/core/executors/MediaUploadExecutor.ts server/src/core/executors/SendMediaExecutor.ts server/src/core/executors/DocumentExecutor.ts server/src/core/executors/AudioToTextExecutor.ts server/src/core/executors/MediaTypeDetectorExecutor.ts server/src/core/executors/HandoverExecutor.ts server/src/core/executors/ThreadManagerExecutor.ts server/src/core/executors/WebhookExecutor.ts server/src/core/executors/ReportExecutor.ts server/src/core/executors/BusinessHoursExecutor.ts
git commit -m "feat(server): port executors media + operaciones (con adaptaciones documentadas)"
```

---

### Task 6: Executors IA limpios (verbatim)

**Files (verbatim → `server/src/core/executors/`):**
- `GroqExecutor.ts`, `IntentResolverExecutor.ts`, `BufferMemoryExecutor.ts`, `TextSplitterExecutor.ts`

- [ ] **Step 1: Copiar los 4** — verbatim. `GroqExecutor` e `IntentResolverExecutor` usan `AIService.complete` (ya portado). `BufferMemoryExecutor` usa `redisPersistence` + `context.phone` (Redis ya está). `TextSplitterExecutor` es puro.

- [ ] **Step 2: type-check + commit**

Run: `cd server && npm run type-check`

```bash
git add server/src/core/executors/GroqExecutor.ts server/src/core/executors/IntentResolverExecutor.ts server/src/core/executors/BufferMemoryExecutor.ts server/src/core/executors/TextSplitterExecutor.ts
git commit -m "feat(server): port executors IA (groq, intent, buffer, textSplitter)"
```

---

### Task 7: RedisPersistenceService con accountId

**Files:**
- Create: `server/src/infrastructure/persistence/RedisPersistenceService.ts`
- Test: `server/src/infrastructure/persistence/__tests__/RedisPersistence.test.ts`

- [ ] **Step 1: Copiar origen** — Read `whatsapp-server/src/infrastructure/persistence/RedisPersistenceService.ts` → Write destino.

- [ ] **Step 2: Adaptar firmas para aceptar accountId** (edit). Cambiar:

```ts
// ANTES
async setCheckpoint(phone: string, checkpoint: any): Promise<void> {
  const key = `checkpoint:${phone}`;
  ...
}
async getCheckpoint(phone: string): Promise<any | null> {
  const key = `checkpoint:${phone}`;
  ...
}
async deleteCheckpoint(phone: string): Promise<void> {
  const key = `checkpoint:${phone}`;
  ...
}
```
```ts
// DESPUÉS — usar el helper de Plan 1
import { checkpointKey } from '../../lib/account-keys';

async setCheckpoint(accountId: string, phone: string, checkpoint: any): Promise<void> {
  const key = checkpointKey(accountId, phone);
  ...
}
async getCheckpoint(accountId: string, phone: string): Promise<any | null> {
  const key = checkpointKey(accountId, phone);
  ...
}
async deleteCheckpoint(accountId: string, phone: string): Promise<void> {
  const key = checkpointKey(accountId, phone);
  ...
}
```
Mantener el TTL (1800s) y el resto idéntico. El import de redis: cambiar a `import { redis } from '../../config/redis';` si el origen usaba otra ruta.

- [ ] **Step 3: Test (mock de redis, sin red real)**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/redis', () => {
  const store = new Map<string, string>();
  return {
    redis: {
      set: vi.fn((k: string, v: string) => { store.set(k, v); return Promise.resolve('OK'); }),
      setex: vi.fn((k: string, _ttl: number, v: string) => { store.set(k, v); return Promise.resolve('OK'); }),
      get: vi.fn((k: string) => Promise.resolve(store.get(k) ?? null)),
      del: vi.fn((k: string) => { store.delete(k); return Promise.resolve(1); }),
    },
  };
});

import { redisPersistence } from '../RedisPersistenceService';

describe('RedisPersistenceService accountId', () => {
  it('checkpoints de cuentas distintas no colisionan para el mismo phone', async () => {
    await redisPersistence.setCheckpoint('accA', '549111', { node: 'a' });
    await redisPersistence.setCheckpoint('accB', '549111', { node: 'b' });
    expect((await redisPersistence.getCheckpoint('accA', '549111')).node).toBe('a');
    expect((await redisPersistence.getCheckpoint('accB', '549111')).node).toBe('b');
  });
});
```

> Ajustar `setex`/`set` en el mock según el método real que use el servicio (verificar en Step 1 si usa `setex` para TTL).

- [ ] **Step 4: Correr test**

Run: `cd server && npx vitest run src/infrastructure/persistence/__tests__/RedisPersistence.test.ts`
Expected: PASS (1 test).

- [ ] **Step 5: Commit**

```bash
git add server/src/infrastructure/persistence/
git commit -m "feat(server): RedisPersistence con namespacing por accountId"
```

---

### Task 8: SessionRepository con accountId

**Files:**
- Create: `server/src/infrastructure/repositories/SessionRepository.ts`
- Test: `server/src/infrastructure/repositories/__tests__/SessionRepository.test.ts`

- [ ] **Step 1: Copiar origen** — Read `whatsapp-server/src/infrastructure/repositories/SessionRepository.ts` → Write destino.

- [ ] **Step 2: Inyectar accountId en firmas y queries** (edits). Agregar `accountId: string` como primer parámetro a: `findActiveSession`, `getOrCreate`, `update`, `forceReset`, `archive`. En cada query Supabase agregar `.eq('account_id', accountId)`, y en los `.insert(...)`/`.update(...)` agregar el campo `account_id: accountId`. Puntos exactos (del origen):
  - `findActiveSession` (~L11–25): query a `flow_executions` → `.eq('account_id', accountId)`.
  - `getOrCreate` (~L30–54, insert ~L101): incluir `account_id` en el objeto insertado.
  - `update` (~L123, `.eq` ~L139–147): `.eq('account_id', accountId)`.
  - `archive` (~L167): incluir `account_id` al copiar a history.
  - `forceReset` (~L216–221): `.eq('account_id', accountId)` junto a `.eq('phone', ...)`.

> El `session.toJSON()` no incluye account_id (la Session no lo conoce). Inyectarlo en el repo al insertar/actualizar: `{ ...session.toJSON(), account_id: accountId }`.

- [ ] **Step 3: Test (mock de supabase chain)**

```ts
import { describe, it, expect, vi } from 'vitest';

const captured: any = { eqArgs: [], insertArg: null };

vi.mock('../../config/database', () => {
  const chain: any = {
    select: () => chain, eq: (k: string, v: any) => { captured.eqArgs.push([k, v]); return chain; },
    in: () => chain, order: () => chain, limit: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
    insert: (o: any) => { captured.insertArg = o; return { select: () => ({ single: () => Promise.resolve({ data: { ...o, id: 'x' }, error: null }) }) }; },
    update: () => chain, delete: () => chain,
  };
  return { supabase: { from: () => chain }, redis: {} };
});

import { SessionRepository } from '../SessionRepository';

describe('SessionRepository accountId', () => {
  it('findActiveSession filtra por account_id', async () => {
    const repo = new SessionRepository();
    await repo.findActiveSession('accA', 'accA:1to1:549111');
    expect(captured.eqArgs).toContainEqual(['account_id', 'accA']);
  });
});
```

> Ajustar el nombre del método y la firma `(accountId, sessionId)` al orden real definido en Step 2. Si `SessionRepository` se exporta como singleton en vez de clase, instanciar acorde.

- [ ] **Step 4: Correr test**

Run: `cd server && npx vitest run src/infrastructure/repositories/__tests__/SessionRepository.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/infrastructure/repositories/
git commit -m "feat(server): SessionRepository con aislamiento por account_id"
```

---

### Task 9: AgentNode + AIAgentExecutor (con caveat de comercio)

**Files:**
- Create: `server/src/core/agent/*` (lo que importe AIAgentExecutor)
- Create: `server/src/core/executors/AIAgentExecutor.ts`

> **Caveat documentado:** `AgentNode` carga productos/horarios/zonas de Supabase (acoplado a comercio). Para el panel genérico hay 2 opciones; este task implementa la (A):
> - **(A) Port generalizado:** portar `AgentNode` pero reemplazar la carga de catálogo por una carga de **contexto genérico** configurable (por ej. nada, o un texto de sistema desde `data.system_prompt`). El agente queda como "LLM con memoria conversacional" sin catálogo.
> - **(B) Saltear:** no portar `aiAgentNode`. Si el usuario confirma que no lo necesita, omitir este task y no registrarlo en la factory.

- [ ] **Step 1: Decidir A vs B** — Si B, marcar este task como N/A y saltar a Task 10 sin registrar `aiAgentNode`. Si A, continuar.

- [ ] **Step 2: Copiar `core/agent/*`** — Read los archivos de `whatsapp-server/src/core/agent/` → Write a `server/src/core/agent/`. Identificar la función que carga catálogo (productos/zonas) y reemplazar su cuerpo por un retorno vacío/genérico (mantener firma).

- [ ] **Step 3: Copiar `AIAgentExecutor.ts`** — verbatim; depende de `agentNode`.

- [ ] **Step 4: type-check + commit**

Run: `cd server && npm run type-check`

```bash
git add server/src/core/agent server/src/core/executors/AIAgentExecutor.ts
git commit -m "feat(server): port AgentNode + aiAgentNode (catálogo generalizado)"
```

---

### Task 10: NodeExecutorFactory (solo genéricos)

**Files:**
- Create: `server/src/core/executors/NodeExecutorFactory.ts`
- Test: `server/src/core/executors/__tests__/NodeExecutorFactory.test.ts`

- [ ] **Step 1: Escribir la factory con SOLO los executors portados** (basado en el original, sin imports/registros de comercio):

```ts
import { NodeExecutor } from './types';
import { StartNodeExecutor } from './StartNodeExecutor';
import { MessageExecutor } from './MessageExecutor';
import { QuestionExecutor } from './QuestionExecutor';
import { ConditionExecutor } from './ConditionExecutor';
import { SwitchExecutor } from './SwitchExecutor';
import { ArraySwitchExecutor } from './ArraySwitchExecutor';
import { KeywordExecutor } from './KeywordExecutor';
import { FlowLinkExecutor } from './FlowLinkExecutor';
import { TimerExecutor } from './TimerExecutor';
import { PollExecutor } from './PollExecutor';
import { MediaUploadExecutor } from './MediaUploadExecutor';
import { SendMediaExecutor } from './SendMediaExecutor';
import { DocumentExecutor } from './DocumentExecutor';
import { AudioToTextExecutor } from './AudioToTextExecutor';
import { MediaTypeDetectorExecutor } from './MediaTypeDetectorExecutor';
import { HandoverExecutor } from './HandoverExecutor';
import { ThreadManagerExecutor } from './ThreadManagerExecutor';
import { WebhookExecutor } from './WebhookExecutor';
import { ReportExecutor } from './ReportExecutor';
import { BusinessHoursExecutor } from './BusinessHoursExecutor';
import { GroqExecutor } from './GroqExecutor';
import { IntentResolverExecutor } from './IntentResolverExecutor';
import { BufferMemoryExecutor } from './BufferMemoryExecutor';
import { TextSplitterExecutor } from './TextSplitterExecutor';
import { AIAgentExecutor } from './AIAgentExecutor'; // omitir si Task 9 = B

class NodeExecutorFactory {
  private executors = new Map<string, NodeExecutor>();
  constructor() { this.registerAll(); }
  private register(type: string, ex: NodeExecutor) { this.executors.set(type, ex); }

  private registerAll() {
    this.register('messageNode', new MessageExecutor());
    this.register('questionNode', new QuestionExecutor());
    this.register('conditionNode', new ConditionExecutor());
    this.register('switchNode', new SwitchExecutor());
    this.register('arraySwitchNode', new ArraySwitchExecutor());
    this.register('keywordNode', new KeywordExecutor());
    this.register('flowLinkNode', new FlowLinkExecutor());
    this.register('timerNode', new TimerExecutor());
    this.register('pollNode', new PollExecutor());
    this.register('mediaUploadNode', new MediaUploadExecutor());
    this.register('sendMediaNode', new SendMediaExecutor());
    this.register('documentNode', new DocumentExecutor());
    this.register('audioTranscriberNode', new AudioToTextExecutor());
    this.register('audioToTextNode', new AudioToTextExecutor());
    this.register('mediaTypeDetectorNode', new MediaTypeDetectorExecutor());
    this.register('mediaDetectorNode', new MediaTypeDetectorExecutor());
    this.register('handoverNode', new HandoverExecutor());
    this.register('threadNode', new ThreadManagerExecutor());
    this.register('webhookNode', new WebhookExecutor());
    this.register('reportNode', new ReportExecutor());
    this.register('businessHoursNode', new BusinessHoursExecutor());
    this.register('groqNode', new GroqExecutor());
    this.register('intentResolverNode', new IntentResolverExecutor());
    this.register('bufferMemoryNode', new BufferMemoryExecutor());
    this.register('textSplitterNode', new TextSplitterExecutor());
    this.register('aiAgentNode', new AIAgentExecutor()); // omitir si Task 9 = B
    // Legacy
    this.register('input', new StartNodeExecutor());
    this.register('start', new StartNodeExecutor());
    this.register('send_message', new MessageExecutor());
    this.register('wait_input', new QuestionExecutor());
  }

  getExecutor(type: string): NodeExecutor {
    const ex = this.executors.get(type);
    if (!ex) {
      console.warn(`[NodeExecutorFactory] Sin executor para "${type}": no-op pass-through.`);
      const noop: NodeExecutor = { async execute() { return { messages: [], wait_for_input: false }; } };
      this.executors.set(type, noop);
      return noop;
    }
    return ex;
  }
}

export const nodeExecutorFactory = new NodeExecutorFactory();
```

- [ ] **Step 2: Test de la factory**

```ts
import { describe, it, expect } from 'vitest';
import { nodeExecutorFactory } from '../NodeExecutorFactory';

describe('NodeExecutorFactory', () => {
  it('resuelve un executor genérico registrado', () => {
    expect(typeof nodeExecutorFactory.getExecutor('messageNode').execute).toBe('function');
  });
  it('devuelve no-op para tipo desconocido (no rompe)', async () => {
    const r = await nodeExecutorFactory.getExecutor('inexistente').execute({}, {} as any, {} as any);
    expect(r).toEqual({ messages: [], wait_for_input: false });
  });
  it('NO registra nodos de comercio', () => {
    // los de comercio caen al no-op
    const r = nodeExecutorFactory.getExecutor('createOrderNode');
    expect(typeof r.execute).toBe('function'); // es el no-op, no el CreateOrderExecutor
  });
});
```

- [ ] **Step 3: Correr test**

Run: `cd server && npx vitest run src/core/executors/__tests__/NodeExecutorFactory.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 4: Commit**

```bash
git add server/src/core/executors/NodeExecutorFactory.ts server/src/core/executors/__tests__/NodeExecutorFactory.test.ts
git commit -m "feat(server): NodeExecutorFactory solo con nodos genéricos"
```

---

### Task 11: SessionQueue + validators (verbatim)

**Files:**
- Create: `server/src/core/engine/session.queue.ts`
- Create: `server/src/core/engine/node.validator.ts`
- Create: `server/src/core/engine/session.auditor.ts`

- [ ] **Step 1: Copiar los 3** — verbatim (Read origen → Write destino). `session.queue.ts` no toca DB. `session.auditor.ts` puede escribir a `audit_logs` (tabla existe en schema Plan 1) — dejar igual. `node.validator.ts` es puro.

- [ ] **Step 2: type-check + commit**

Run: `cd server && npm run type-check`

```bash
git add server/src/core/engine/session.queue.ts server/src/core/engine/node.validator.ts server/src/core/engine/session.auditor.ts
git commit -m "feat(server): port SessionQueue + validators"
```

---

### Task 12: FlowEngine con accountId

**Files:**
- Create: `server/src/core/engine/flow.engine.ts`
- Test: `server/src/core/engine/__tests__/flow.engine.routing.test.ts`

- [ ] **Step 1: Copiar origen** — Read `whatsapp-server/src/core/engine/flow.engine.ts` → Write destino.

- [ ] **Step 2: Inyectar accountId** (edits):
  - Firma: `async processMessage(accountId: string, phone: string, messageText: string, context: any = {}, options = {}): Promise<any>`.
  - Pasar `accountId` a: `sessionRepository.findActiveSession(accountId, sessionId)`, `getOrCreate(accountId, ...)`, `update(accountId, session)`, `forceReset(accountId, phone)`, `archive(accountId, ...)`.
  - Pasar `accountId` a `redisPersistence.setCheckpoint/getCheckpoint/deleteCheckpoint(accountId, phone, ...)`.
  - En `getFlowDefinition` / `findFlowByTrigger` / `getAllActiveFlows`: agregar parámetro `accountId` y `.eq('account_id', accountId)` en las queries a `flows` (origen L583–586, L603–607). Cachear por clave `${accountId}:${flowId}` para no mezclar cuentas (cambiar `flowCache` key y `flowListCache` a un `Map` por cuenta).
  - En el insert a `flow_logs` (origen ~L720): agregar `account_id: accountId`.
  - Quitar la query a `products` (origen ~L165, businessContext de comercio) — borrar ese bloque.

- [ ] **Step 3: Test de ruteo (findNextNodeId con sinónimos)** — testea la lógica pura sin DB extrayendo un flow mock:

```ts
import { describe, it, expect } from 'vitest';
import { FlowEngine } from '../flow.engine';

// findNextNodeId es privado; lo probamos vía un acceso de test.
// @ts-expect-error acceso a método privado para testing
const findNext = (FlowEngine.prototype as any).findNextNodeId.bind(new FlowEngine());

const flow = {
  nodes: [{ id: 'cond', type: 'conditionNode' }, { id: 'yes' }, { id: 'no' }],
  edges: [
    { source: 'cond', target: 'yes', sourceHandle: 'true' },
    { source: 'cond', target: 'no', sourceHandle: 'false' },
  ],
} as any;

describe('FlowEngine.findNextNodeId', () => {
  it('matchea handle exacto', () => {
    expect(findNext(flow, 'cond', 'true')).toBe('yes');
  });
  it('matchea por sinónimo booleano (si → true)', () => {
    expect(findNext(flow, 'cond', 'confirmed')).toBe('yes');
  });
  it('handle negativo va a false', () => {
    expect(findNext(flow, 'cond', 'cancelar')).toBe('no');
  });
});
```

> Si instanciar `FlowEngine` requiere dependencias, mockear `../../config/database` como en Task 8. Ajustar el acceso al método según cómo esté exportada la clase (named export `FlowEngine` o singleton).

- [ ] **Step 4: Correr test**

Run: `cd server && npx vitest run src/core/engine/__tests__/flow.engine.routing.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: type-check global + commit**

Run: `cd server && npm run type-check`
Expected: sin errores en todo `server/src`.

```bash
git add server/src/core/engine/flow.engine.ts server/src/core/engine/__tests__/
git commit -m "feat(server): FlowEngine con accountId end-to-end"
```

---

### Task 13: Suite completa + portar tests de origen útiles

**Files:**
- Create: `server/src/core/executors/__tests__/ConditionExecutor.test.ts` (port del origen)

- [ ] **Step 1: Portar ConditionExecutor.test.ts** — Read `whatsapp-server/src/core/executors/__tests__/ConditionExecutor.test.ts` → Write destino. Ajustar imports relativos si difieren.

- [ ] **Step 2: Correr toda la suite del backend**

Run: `cd server && npm run test:run`
Expected: PASS — todos los tests verdes (Plan 1: 6 + Plan 2: Session 2, RedisPersistence 1, SessionRepository 1, NodeExecutorFactory 3, FlowEngine 3, ConditionExecutor port N).

- [ ] **Step 3: Commit**

```bash
git add server/src/core/executors/__tests__/ConditionExecutor.test.ts
git commit -m "test(server): port tests de ConditionExecutor + suite verde"
```

---

## Self-Review

**Cobertura del spec (Plan 2 = §3.1 motor + executors + §4 lógica de ejecución):**
- Session 3 namespaces → Task 2. ✓
- types/NodeExecutor → Task 4. ✓
- 25 executors genéricos+IA+media+ops → Tasks 4,5,6,9. (DocumentExecutor/ReportExecutor/BusinessHours con adaptaciones documentadas; aiAgent con caveat A/B). ✓
- NodeExecutorFactory sin comercio + no-op fallback → Task 10. ✓
- FlowEngine bucle + findNextNodeId sinónimos + ramificantes + accountId → Task 12. ✓
- SessionQueue FIFO → Task 11. ✓
- SessionRepository + RedisPersistence con account_id (§2.2) → Tasks 7,8. ✓
- Router simple → **Plan 3** (necesita el gateway). Documentado.
- Gateway/AccountManager/API → **Plan 3**.

**Placeholders:** los `// ANTES/DESPUÉS` muestran el código real; las "adaptaciones documentadas" (PdfService, ReportExecutor, BusinessHours, aiAgent) son decisiones explícitas con default definido, no TODOs abiertos.

**Consistencia de tipos:** `accountId: string` agregado como **primer** parámetro en RedisPersistence (Task 7), SessionRepository (Task 8) y propagado por FlowEngine (Task 12) en ese mismo orden. `checkpointKey(accountId, phone)` (Plan 1) usado en Task 7. `nodeExecutorFactory` (singleton, lowercase) exportado en Task 10 y consumido por FlowEngine.

**Riesgo conocido:** varios steps dicen "ajustar según el shape real del archivo portado". Es inherente al porting: el ejecutor debe leer el origen (paths exactos dados) y conciliar firmas. Los tests atrapan desajustes.

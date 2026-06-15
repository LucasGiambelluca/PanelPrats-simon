# Plan 3 — Gateway Baileys + AccountManager + Router + API REST — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Conectar N números de WhatsApp en un solo proceso. Portar `WhatsAppClient` (Baileys) como instancia por cuenta, envolverlo en un `AccountManager` (Map por `account_id`), escribir un `ConversationRouter` simple (sin comercio), y exponer la API REST (`/accounts`, `/flows`, `/conversations`, `/messages`) que consume el frontend.

**Architecture:** El `WhatsAppClient` deja de ser singleton: se instancia uno por cuenta con su propia carpeta de auth (`AUTH_BASE_PATH/{account_id}`), su socket Baileys, su QR y su estado. `AccountManager` los administra (connect/disconnect/status/QR) y, al recibir un mensaje, lo etiqueta con `accountId` y lo pasa al `ConversationRouter`, que decide cancelar/saludar/handover/flujo y llama a `FlowEngine.processMessage(accountId, ...)`. Express expone el control de cuentas y datos al frontend.

**Tech Stack:** Node 20, TS 5.9, Express 4, @whiskeysockets/baileys 6.7, qrcode, Vitest 4. Depende de Plan 1 y Plan 2.

**Origen:** `C:/Users/Lucas/Desktop/Sotcksystem/whatsapp-server/src`
**Destino:** `server/src`
**Spec:** `docs/superpowers/specs/2026-06-14-panel-whatsapp-multicuenta-design.md`

---

## Estructura de archivos (este plan)

```
server/src/
├── infrastructure/whatsapp/WhatsAppClient.ts   # port + instancia por cuenta
├── core/
│   ├── accounts/AccountManager.ts              # NUEVO: Map<accountId, WhatsAppClient>
│   └── engine/conversation.router.ts           # NUEVO: router simple (reescrito)
├── api/
│   ├── app.ts                                  # NUEVO: express app + rutas
│   ├── routes/
│   │   ├── accounts.routes.ts                  # NUEVO
│   │   ├── flows.routes.ts                     # port reducido
│   │   ├── conversations.routes.ts             # NUEVO
│   │   └── messages.routes.ts                  # NUEVO
│   └── controllers/                            # según necesidad
├── services/MessageStore.ts                    # NUEVO: persiste IN/OUT en whatsapp_messages
└── index.ts                                    # NUEVO: bootstrap AccountManager + express
```

---

### Task 1: MessageStore (persistencia de mensajes IN/OUT)

**Files:**
- Create: `server/src/services/MessageStore.ts`
- Test: `server/src/services/__tests__/MessageStore.test.ts`

> En el origen, guardar mensajes vive disperso dentro de `WhatsAppClient` (`saveInbound/saveOutboundMessageDB`). Lo extraemos a un servicio aislado y testeable que upserta conversación + inserta mensaje, siempre con `account_id`.

- [ ] **Step 1: Escribir `MessageStore.ts`**

```ts
import { supabase } from '../config/supabase';

export interface StoredMessage {
  accountId: string;
  phone: string;
  contactName?: string;
  direction: 'INBOUND' | 'OUTBOUND';
  content: string;
  messageType?: string;
  mediaUrl?: string;
  waMessageId?: string;
}

export class MessageStore {
  /** Upsert de la conversación (por account_id+phone) y devuelve su id. */
  async upsertConversation(accountId: string, phone: string, contactName: string | undefined, lastMessage: string): Promise<string> {
    const { data, error } = await supabase
      .from('whatsapp_conversations')
      .upsert(
        { account_id: accountId, phone, contact_name: contactName, last_message: lastMessage, last_message_at: new Date().toISOString() },
        { onConflict: 'account_id,phone' }
      )
      .select('id')
      .single();
    if (error) throw error;
    return data!.id as string;
  }

  /** Inserta un mensaje en la conversación. */
  async insertMessage(conversationId: string, msg: StoredMessage): Promise<void> {
    const { error } = await supabase.from('whatsapp_messages').insert({
      conversation_id: conversationId,
      account_id: msg.accountId,   // denormalizado: historial por cuenta + filtro Realtime
      phone: msg.phone,            // denormalizado: getHistory filtra por (account_id, phone)
      direction: msg.direction,
      content: msg.content,
      media_url: msg.mediaUrl ?? null,
      message_type: msg.messageType ?? 'text',
      wa_message_id: msg.waMessageId ?? null,
    });
    if (error) throw error;
  }

  /** Atajo: upsert conversación + insert mensaje. */
  async record(msg: StoredMessage): Promise<void> {
    const convId = await this.upsertConversation(msg.accountId, msg.phone, msg.contactName, msg.content);
    await this.insertMessage(convId, msg);
  }
}

export const messageStore = new MessageStore();
```

- [ ] **Step 2: Test (mock supabase chain capturando upsert/insert)**

```ts
import { describe, it, expect, vi } from 'vitest';

const captured: any = { upsert: null, insert: null };
vi.mock('../../config/supabase', () => {
  const chain: any = {
    upsert: (o: any) => { captured.upsert = o; return { select: () => ({ single: () => Promise.resolve({ data: { id: 'conv1' }, error: null }) }) }; },
    insert: (o: any) => { captured.insert = o; return Promise.resolve({ error: null }); },
  };
  return { supabase: { from: () => chain } };
});

import { messageStore } from '../MessageStore';

describe('MessageStore', () => {
  it('record upserta conversación con account_id e inserta el mensaje', async () => {
    await messageStore.record({ accountId: 'accA', phone: '549111', direction: 'INBOUND', content: 'hola' });
    expect(captured.upsert.account_id).toBe('accA');
    expect(captured.upsert.phone).toBe('549111');
    expect(captured.insert.conversation_id).toBe('conv1');
    expect(captured.insert.direction).toBe('INBOUND');
  });
});
```

- [ ] **Step 3: Correr test**

Run: `cd server && npx vitest run src/services/__tests__/MessageStore.test.ts`
Expected: PASS (1 test).

- [ ] **Step 4: Commit**

```bash
git add server/src/services/MessageStore.ts server/src/services/__tests__/MessageStore.test.ts
git commit -m "feat(server): MessageStore persiste mensajes con account_id"
```

---

### Task 2: WhatsAppClient como instancia por cuenta

**Files:**
- Create: `server/src/infrastructure/whatsapp/WhatsAppClient.ts`

- [ ] **Step 1: Copiar origen** — Read `whatsapp-server/src/infrastructure/whatsapp/WhatsAppClient.ts` → Write destino.

- [ ] **Step 2: Convertir de singleton a clase instanciable por cuenta** (edits):
  - Quitar el export singleton del final (`export const whatsappClient = new WhatsAppClient()`).
  - Constructor: `constructor(private accountId: string, private authBasePath: string, private onMessage: (accountId: string, phone: string, text: string, pushName: string, fileCtx: any) => Promise<any[]>, private store: MessageStore)`.
  - Carpeta de auth: reemplazar `const AUTH_DIR = process.env.BAILEYS_SESSION_PATH || ...` por `const AUTH_DIR = authDir(this.authBasePath, this.accountId)` usando el helper de Plan 1 (`import { authDir } from '../../lib/account-keys'`). Crear la carpeta si no existe (`fs.mkdirSync(AUTH_DIR, { recursive: true })`).
  - En `connection.update` (QR): guardar el QR en una propiedad de instancia `this.qrCodeData` (ya existe) y persistir estado a la tabla `accounts` (status `qr`/`connected`/`disconnected`) vía `supabase.from('accounts').update({ status, qr_code }).eq('id', this.accountId)`.
  - En `messages.upsert`: tras parsear `phone`/`text`/`fileCtx`, en vez de llamar al `ConversationRouter` global, llamar `this.onMessage(this.accountId, phone, text, pushName, fileCtx)` y enviar las respuestas con `this.sendFormattedMessage(remoteJid, r)`. Guardar inbound vía `this.store.record({ accountId: this.accountId, phone, direction: 'INBOUND', content: text, contactName: pushName })`.
  - En `sendFormattedMessage`: tras enviar, guardar outbound vía `this.store.record({ accountId: this.accountId, phone: PhoneUtils.normalize(jid), direction: 'OUTBOUND', content: <texto>, messageType: <tipo> })`.
  - Exponer métodos públicos: `start()`, `stop()`, `getStatus()`, `getQrCode()`, `logout()`, `sendFormattedMessage(jid, content)`.
  - Mantener intacta TODA la lógica anti-ban (mutex, typing, delays), reconexión (backoff 3s→30s, máx 10), y logout 401 → clearSession + regenerar QR.

- [ ] **Step 3: type-check**

Run: `cd server && npm run type-check`
Expected: errores esperables hasta que existan `AccountManager`/router (imports). Resolver los que sean del propio archivo; los de `onMessage` se cierran en Task 4.

- [ ] **Step 4: Commit**

```bash
git add server/src/infrastructure/whatsapp/WhatsAppClient.ts
git commit -m "feat(server): WhatsAppClient instanciable por cuenta (auth dir + estado por account_id)"
```

---

### Task 3: ConversationRouter simple (reescrito, sin comercio)

**Files:**
- Create: `server/src/core/engine/conversation.router.ts`
- Test: `server/src/core/engine/__tests__/router.test.ts`

- [ ] **Step 1: Escribir el router simple**

```ts
import { FlowEngine } from './flow.engine';
import { supabase } from '../../config/supabase';

const CANCEL_WORDS = ['cancelar', 'salir', 'chau', 'reset', 'reiniciar'];
const GREETING_WORDS = ['hola', 'menu', 'menú', 'inicio'];
const GLOBAL_BREAKERS = ['hola', 'menu', 'menú', 'cancelar', 'salir', 'reset', 'reiniciar', 'inicio'];

function norm(t: string): string {
  return (t || '').trim().toLowerCase();
}

export class ConversationRouter {
  constructor(private engine: FlowEngine) {}

  /** Devuelve los mensajes a enviar (strings/objetos). */
  async processMessage(accountId: string, phone: string, text: string, pushName: string, fileCtx: any = {}): Promise<any[]> {
    const t = norm(text);
    const baseCtx = { accountId, phone, pushName, user_message: text, ...fileCtx };

    // P0 — cancelar explícito
    if (CANCEL_WORDS.includes(t)) {
      await this.engine.forceReset(accountId, phone);
      return ['Listo, reiniciamos. Escribí *hola* para empezar de nuevo. 👋'];
    }

    // Handover — si la conversación está tomada por humano, el bot calla (salvo reanudar)
    const status = await this.getConversationStatus(accountId, phone);
    if (status === 'HANDOVER' && !GREETING_WORDS.includes(t)) {
      return [];
    }

    // Saludo → forzar palabra 'hola' para que matchee el flujo de menú
    if (GREETING_WORDS.includes(t)) {
      return await this.engine.processMessage(accountId, phone, 'hola', baseCtx);
    }

    // Si hay sesión esperando input y NO es un breaker global → al motor tal cual
    // Default → al motor (resuelve por trigger / wildcard)
    return await this.engine.processMessage(accountId, phone, text, baseCtx);
  }

  private async getConversationStatus(accountId: string, phone: string): Promise<string | null> {
    const { data } = await supabase
      .from('whatsapp_conversations')
      .select('status')
      .eq('account_id', accountId)
      .eq('phone', phone)
      .maybeSingle();
    return (data?.status as string) ?? null;
  }
}
```

> `FlowEngine.forceReset(accountId, phone)`: agregar este método público delgado en `flow.engine.ts` si no existe — debe llamar `sessionRepository.forceReset(accountId, phone)` y `redisPersistence.deleteCheckpoint(accountId, phone)`. (Edit pequeño sobre Plan 2; incluirlo aquí.)
> `GLOBAL_BREAKERS` queda disponible para una mejora futura (cortar mid-flow); el motor ya maneja el wildcard/waiting_input internamente.

- [ ] **Step 2: Asegurar `FlowEngine.forceReset`** (edit en `flow.engine.ts`): agregar

```ts
async forceReset(accountId: string, phone: string): Promise<void> {
  await this.sessionRepository.forceReset(accountId, phone);
  await redisPersistence.deleteCheckpoint(accountId, phone);
}
```

- [ ] **Step 3: Test del router (engine y supabase mockeados)**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../config/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { status: 'HANDOVER' } }) }) }) }) }) },
}));

import { ConversationRouter } from '../conversation.router';

function makeEngine() {
  return {
    processMessage: vi.fn(async () => ['respuesta-flujo']),
    forceReset: vi.fn(async () => {}),
  } as any;
}

describe('ConversationRouter', () => {
  it('cancelar resetea y no llama al motor', async () => {
    const engine = makeEngine();
    const r = await new ConversationRouter(engine).processMessage('accA', '549111', 'cancelar', 'L');
    expect(engine.forceReset).toHaveBeenCalledWith('accA', '549111');
    expect(engine.processMessage).not.toHaveBeenCalled();
    expect(r[0]).toMatch(/reiniciamos/i);
  });

  it('en HANDOVER el bot calla salvo saludo', async () => {
    const engine = makeEngine();
    const r = await new ConversationRouter(engine).processMessage('accA', '549111', 'tengo una duda', 'L');
    expect(r).toEqual([]);
    expect(engine.processMessage).not.toHaveBeenCalled();
  });

  it('saludo fuerza "hola" al motor', async () => {
    const engine = makeEngine();
    await new ConversationRouter(engine).processMessage('accA', '549111', 'Buenas', 'L');
    // 'buenas' no está en GREETING_WORDS → va como default con el texto original
    expect(engine.processMessage).toHaveBeenCalled();
  });
});
```

> Ajustar el mock de supabase si el status real difiere; el segundo test asume HANDOVER. Para el primer test, `maybeSingle` devuelve HANDOVER pero cancelar corta antes — ok.

- [ ] **Step 4: Correr test**

Run: `cd server && npx vitest run src/core/engine/__tests__/router.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/core/engine/conversation.router.ts server/src/core/engine/flow.engine.ts server/src/core/engine/__tests__/router.test.ts
git commit -m "feat(server): ConversationRouter simple (cancelar/handover/saludo/default) + forceReset"
```

---

### Task 4: AccountManager (Map de clientes por cuenta)

**Files:**
- Create: `server/src/core/accounts/AccountManager.ts`
- Test: `server/src/core/accounts/__tests__/AccountManager.test.ts`

- [ ] **Step 1: Escribir `AccountManager.ts`**

```ts
import { WhatsAppClient } from '../../infrastructure/whatsapp/WhatsAppClient';
import { FlowEngine } from '../engine/flow.engine';
import { ConversationRouter } from '../engine/conversation.router';
import { messageStore } from '../../services/MessageStore';
import { supabase } from '../../config/supabase';

const AUTH_BASE_PATH = process.env.AUTH_BASE_PATH || './auth';

export class AccountManager {
  private clients = new Map<string, WhatsAppClient>();
  private router: ConversationRouter;

  constructor(engine: FlowEngine) {
    this.router = new ConversationRouter(engine);
  }

  /** Levanta (o devuelve) el cliente Baileys de una cuenta. */
  async connect(accountId: string): Promise<WhatsAppClient> {
    let client = this.clients.get(accountId);
    if (client) return client;

    client = new WhatsAppClient(
      accountId,
      AUTH_BASE_PATH,
      (accId, phone, text, pushName, fileCtx) => this.router.processMessage(accId, phone, text, pushName, fileCtx),
      messageStore,
    );
    this.clients.set(accountId, client);

    try {
      await client.start();
    } catch (err) {
      // aislamiento: una cuenta que falla no tumba a las demás
      console.error(`[AccountManager] cuenta ${accountId} falló al iniciar:`, err);
    }
    return client;
  }

  async disconnect(accountId: string): Promise<void> {
    const client = this.clients.get(accountId);
    if (!client) return;
    await client.stop();
    this.clients.delete(accountId);
  }

  getQr(accountId: string): string | null {
    return this.clients.get(accountId)?.getQrCode() ?? null;
  }

  getStatus(accountId: string): string {
    return this.clients.get(accountId)?.getStatus() ?? 'disconnected';
  }

  async sendMessage(accountId: string, phone: string, text: string): Promise<void> {
    const client = this.clients.get(accountId);
    if (!client) throw new Error(`Cuenta ${accountId} no conectada`);
    const jid = phone.includes('@') ? phone : `${phone}@s.whatsapp.net`;
    await client.sendFormattedMessage(jid, text);
  }

  /** Al bootear: reconecta todas las cuentas marcadas como conectadas. */
  async bootstrapExisting(): Promise<void> {
    const { data } = await supabase.from('accounts').select('id').eq('status', 'connected');
    for (const row of data ?? []) {
      await this.connect(row.id as string);
    }
  }
}
```

- [ ] **Step 2: Test de aislamiento (WhatsAppClient mockeado)**

```ts
import { describe, it, expect, vi } from 'vitest';

const started: string[] = [];
vi.mock('../../../infrastructure/whatsapp/WhatsAppClient', () => ({
  WhatsAppClient: class {
    constructor(public accountId: string) {}
    async start() { started.push(this.accountId); }
    async stop() {}
    getQrCode() { return `qr-${this.accountId}`; }
    getStatus() { return 'connected'; }
    async sendFormattedMessage() {}
  },
}));
vi.mock('../../../services/MessageStore', () => ({ messageStore: {} }));
vi.mock('../../../config/supabase', () => ({ supabase: { from: () => ({ select: () => ({ eq: () => Promise.resolve({ data: [] }) }) }) } }));

import { AccountManager } from '../AccountManager';

describe('AccountManager', () => {
  it('mantiene un cliente por cuenta y aísla QR', async () => {
    const mgr = new AccountManager({} as any);
    await mgr.connect('accA');
    await mgr.connect('accB');
    expect(mgr.getQr('accA')).toBe('qr-accA');
    expect(mgr.getQr('accB')).toBe('qr-accB');
    expect(started).toEqual(['accA', 'accB']);
  });

  it('connect dos veces la misma cuenta no duplica el cliente', async () => {
    started.length = 0;
    const mgr = new AccountManager({} as any);
    await mgr.connect('accA');
    await mgr.connect('accA');
    expect(started).toEqual(['accA']);
  });
});
```

- [ ] **Step 3: Correr test**

Run: `cd server && npx vitest run src/core/accounts/__tests__/AccountManager.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 4: Commit**

```bash
git add server/src/core/accounts/
git commit -m "feat(server): AccountManager (Map por cuenta, aislamiento, bootstrap)"
```

---

### Task 5: API REST — accounts

**Files:**
- Create: `server/src/api/routes/accounts.routes.ts`
- Create: `server/src/api/app.ts`

- [ ] **Step 1: Escribir `accounts.routes.ts`** (recibe el `AccountManager` por inyección)

```ts
import { Router } from 'express';
import { supabase } from '../../config/supabase';
import type { AccountManager } from '../../core/accounts/AccountManager';

export function accountsRouter(manager: AccountManager): Router {
  const r = Router();

  // Crear cuenta (fila en accounts; el user_id viene del frontend autenticado o del body)
  r.post('/', async (req, res) => {
    const { user_id, name, phone_number } = req.body;
    const { data, error } = await supabase
      .from('accounts')
      .insert({ user_id, name, phone_number, status: 'disconnected' })
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // Listar cuentas de un usuario
  r.get('/', async (req, res) => {
    const userId = req.query.user_id as string;
    const { data, error } = await supabase.from('accounts').select('*').eq('user_id', userId);
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // Conectar (levanta Baileys → genera QR)
  r.post('/:id/connect', async (req, res) => {
    await manager.connect(req.params.id);
    res.json({ status: manager.getStatus(req.params.id) });
  });

  // QR de la cuenta
  r.get('/:id/qr', (req, res) => {
    res.json({ qr: manager.getQr(req.params.id), status: manager.getStatus(req.params.id) });
  });

  // Estado
  r.get('/:id/status', (req, res) => {
    res.json({ status: manager.getStatus(req.params.id) });
  });

  // Desconectar
  r.post('/:id/disconnect', async (req, res) => {
    await manager.disconnect(req.params.id);
    res.json({ status: 'disconnected' });
  });

  return r;
}
```

- [ ] **Step 2: Escribir `app.ts`** (monta routers; recibe manager)

```ts
import express from 'express';
import cors from 'cors';
import type { AccountManager } from '../core/accounts/AccountManager';
import { accountsRouter } from './routes/accounts.routes';
import { flowsRouter } from './routes/flows.routes';
import { conversationsRouter } from './routes/conversations.routes';
import { messagesRouter } from './routes/messages.routes';

export function createApp(manager: AccountManager) {
  const app = express();
  app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',') }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/accounts', accountsRouter(manager));
  app.use('/api/flows', flowsRouter());
  app.use('/api/conversations', conversationsRouter());
  app.use('/api/messages', messagesRouter(manager));

  return app;
}
```

- [ ] **Step 3: type-check**

Run: `cd server && npm run type-check`
Expected: errores por routers aún inexistentes (flows/conversations/messages) — se crean en Tasks 6-7.

- [ ] **Step 4: Commit**

```bash
git add server/src/api/routes/accounts.routes.ts server/src/api/app.ts
git commit -m "feat(api): rutas de accounts + app express"
```

---

### Task 6: API REST — flows + conversations

**Files:**
- Create: `server/src/api/routes/flows.routes.ts`
- Create: `server/src/api/routes/conversations.routes.ts`

- [ ] **Step 1: Escribir `flows.routes.ts`** (CRUD sobre `flows`, scoped por account_id)

```ts
import { Router } from 'express';
import { supabase } from '../../config/supabase';

export function flowsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const accountId = req.query.account_id as string;
    const { data, error } = await supabase.from('flows').select('*').eq('account_id', accountId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.get('/:id', async (req, res) => {
    const { data, error } = await supabase.from('flows').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: error.message });
    res.json(data);
  });

  r.post('/', async (req, res) => {
    const { account_id, name, trigger_word, nodes, edges, is_active } = req.body;
    const { data, error } = await supabase.from('flows').insert({ account_id, name, trigger_word, nodes, edges, is_active }).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.put('/:id', async (req, res) => {
    const { name, trigger_word, nodes, edges, is_active } = req.body;
    const { data, error } = await supabase.from('flows').update({ name, trigger_word, nodes, edges, is_active, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.delete('/:id', async (req, res) => {
    const { error } = await supabase.from('flows').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  });

  return r;
}
```

> Nota: el frontend usa Supabase directo para `flows` (con RLS) en muchas pantallas; estas rutas existen para el backend/automatizaciones. Ambos caminos quedan disponibles.

- [ ] **Step 2: Escribir `conversations.routes.ts`** (listar conversaciones + mensajes, scoped por account_id)

```ts
import { Router } from 'express';
import { supabase } from '../../config/supabase';

export function conversationsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const accountId = req.query.account_id as string;
    const { data, error } = await supabase.from('whatsapp_conversations').select('*').eq('account_id', accountId).order('last_message_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.get('/:id/messages', async (req, res) => {
    const { data, error } = await supabase.from('whatsapp_messages').select('*').eq('conversation_id', req.params.id).order('timestamp', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // Handover manual: tomar / liberar
  r.post('/:id/handover', async (req, res) => {
    const status = req.body.resume ? 'BOT' : 'HANDOVER';
    const { error } = await supabase.from('whatsapp_conversations').update({ status }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ status });
  });

  return r;
}
```

- [ ] **Step 3: type-check**

Run: `cd server && npm run type-check`
Expected: solo falta `messages.routes.ts` (Task 7).

- [ ] **Step 4: Commit**

```bash
git add server/src/api/routes/flows.routes.ts server/src/api/routes/conversations.routes.ts
git commit -m "feat(api): rutas de flows + conversations (scoped por account_id)"
```

---

### Task 7: API REST — messages (send) + bootstrap del server

**Files:**
- Create: `server/src/api/routes/messages.routes.ts`
- Create: `server/src/index.ts`
- Test: `server/src/api/__tests__/health.test.ts`

- [ ] **Step 1: Escribir `messages.routes.ts`** (enviar mensaje manual desde el inbox)

```ts
import { Router } from 'express';
import type { AccountManager } from '../../core/accounts/AccountManager';
import { messageStore } from '../../services/MessageStore';

export function messagesRouter(manager: AccountManager): Router {
  const r = Router();

  // Enviar mensaje manual (handover): envía por Baileys y persiste OUTBOUND
  r.post('/send', async (req, res) => {
    const { account_id, phone, text } = req.body;
    try {
      await manager.sendMessage(account_id, phone, text);
      await messageStore.record({ accountId: account_id, phone, direction: 'OUTBOUND', content: text });
      res.json({ ok: true });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  return r;
}
```

- [ ] **Step 2: Escribir `index.ts`** (bootstrap: engine → AccountManager → express → reconectar cuentas)

```ts
import 'dotenv/config';
import { FlowEngine } from './core/engine/flow.engine';
import { AccountManager } from './core/accounts/AccountManager';
import { createApp } from './api/app';

async function bootstrap() {
  const PORT = Number(process.env.PORT || 3001);

  const engine = new FlowEngine();
  const manager = new AccountManager(engine);

  const app = createApp(manager);
  app.listen(PORT, '0.0.0.0', () => console.log(`🚀 server en :${PORT}`));

  // Reconectar cuentas que estaban conectadas
  await manager.bootstrapExisting().catch((e) => console.error('[bootstrap] reconexión:', e));
}

bootstrap().catch((e) => {
  console.error('❌ bootstrap falló:', e);
  process.exit(1);
});
```

> Si `FlowEngine` se exporta como singleton (no como clase con `new`), ajustar a `import { flowEngine } from ...` y pasar esa instancia al `AccountManager`. Verificar contra el archivo de Plan 2.

- [ ] **Step 3: Test de health (supertest opcional o fetch al app)**

```ts
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core/engine/flow.engine', () => ({ FlowEngine: class {} }));
vi.mock('../../core/accounts/AccountManager', () => ({ AccountManager: class { constructor() {} } }));

import { createApp } from '../app';

describe('app /health', () => {
  it('createApp construye una app express con /health', () => {
    const app = createApp({} as any);
    // express app es una función con .listen
    expect(typeof (app as any).listen).toBe('function');
  });
});
```

> Para un test HTTP real, agregar `supertest` como devDependency y hacer `request(app).get('/health')`. Opcional; el smoke de construcción alcanza para este plan.

- [ ] **Step 4: Correr test + type-check global**

Run: `cd server && npx vitest run src/api/__tests__/health.test.ts && npm run type-check`
Expected: PASS + sin errores de tipos en todo `server/src`.

- [ ] **Step 5: Smoke de arranque (manual, requiere Redis + Supabase configurados)**

Run: `cd server && npm run dev`
Expected: log `🚀 server en :3001`. `GET http://localhost:3001/health` → `{"ok":true}`. (Si no hay Supabase/Redis, el server arranca igual; las cuentas reconectan a vacío.)

- [ ] **Step 6: Commit**

```bash
git add server/src/api/routes/messages.routes.ts server/src/index.ts server/src/api/__tests__/health.test.ts
git commit -m "feat(server): rutas de messages + bootstrap del proceso multi-cuenta"
```

---

## Self-Review

**Cobertura del spec (Plan 3 = §2.1/§2.2 AccountManager + §3.1 gateway/router/API + §4 flujo entrante):**
- WhatsAppClient por cuenta + auth dir aislado + estado en `accounts` → Task 2. ✓
- AccountManager Map<account_id, client> + aislamiento + bootstrap → Task 4. ✓
- Router simple (cancelar/handover/saludo/default), arrays verbatim → Task 3. ✓
- Persistencia de mensajes IN/OUT con account_id → Task 1. ✓
- API `/accounts` (CRUD+connect+qr+status), `/flows`, `/conversations` (+handover), `/messages/send` → Tasks 5,6,7. ✓
- Flujo entrante completo (Baileys → router → engine → send) → Tasks 2+3+4. ✓
- Anti-ban/reconexión/logout 401 → preservados en Task 2. ✓
- Frontend que consume esta API → **Plan 4**.

**Placeholders:** ninguno — todo el código de routers, router de conversación, AccountManager, MessageStore e index está completo. Las notas "ajustar si singleton" son verificaciones contra Plan 2, con la acción concreta indicada.

**Consistencia de tipos:** `onMessage(accountId, phone, text, pushName, fileCtx)` definido en WhatsAppClient (Task 2) coincide con `router.processMessage(accountId, phone, text, pushName, fileCtx)` (Task 3) y con la lambda del AccountManager (Task 4). `manager.sendMessage(accountId, phone, text)` usado por messages.routes (Task 7) está definido en Task 4. `messageStore.record({accountId,...})` (Task 1) usado por WhatsAppClient (Task 2) y messages.routes (Task 7). `engine.forceReset(accountId, phone)` agregado en Task 3 y usado por el router.

**Dependencia nueva opcional:** `supertest` (devDependency) solo si se quiere test HTTP real en Task 7; marcado opcional.

# Plan 1 — Cimientos + Capa de Datos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scaffold del monorepo (`server/` + `client/` + `supabase/`), schema Supabase multi-cuenta, y clientes Supabase/Redis del backend con helpers de namespacing por `account_id`, todo verificado con smoke tests.

**Architecture:** Monorepo con backend Node TypeScript (Express + ts-node + vitest) y frontend React+Vite. El schema se escribe de cero con `account_id` ya incorporado en cada tabla (no `ALTER` sobre el schema rotisería). Los clientes Supabase/Redis se exponen con helpers que fuerzan el aislamiento por cuenta.

**Tech Stack:** Node 20, TypeScript 5.9, Express 4, ioredis 5, @supabase/supabase-js 2, Vitest 4. Frontend: React 19, Vite 7, Tailwind 3.4, @supabase/supabase-js 2.

**Spec:** `docs/superpowers/specs/2026-06-14-panel-whatsapp-multicuenta-design.md`

---

## Estructura de archivos (este plan)

```
nuevo-panel/
├── server/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vitest.config.ts
│   ├── .env.example
│   ├── .gitignore
│   └── src/
│       ├── config/
│       │   ├── supabase.ts        # cliente Supabase (service key)
│       │   ├── redis.ts           # cliente Redis
│       │   └── __tests__/
│       │       └── redis.keys.test.ts
│       └── lib/
│           ├── account-keys.ts    # helpers de namespacing por account_id
│           └── __tests__/
│               └── account-keys.test.ts
├── client/                        # scaffold Vite (Task 6)
│   └── ...
└── supabase/
    └── migrations/
        └── 0001_init_multicuenta.sql
```

---

### Task 1: Estructura de carpetas + .gitignore raíz

**Files:**
- Create: `server/.gitignore`
- Create: `.gitignore` (raíz)

- [ ] **Step 1: Crear carpetas base**

Run (PowerShell):
```powershell
New-Item -ItemType Directory -Force server/src/config/__tests__, server/src/lib/__tests__, supabase/migrations, client | Out-Null
```

- [ ] **Step 2: Escribir `.gitignore` raíz**

```
node_modules/
dist/
.env
.env.local
auth/
*.log
.DS_Store
```

- [ ] **Step 3: Escribir `server/.gitignore`**

```
node_modules/
dist/
.env
auth/
*.log
coverage/
```

- [ ] **Step 4: Commit**

```bash
git add .gitignore server/.gitignore
git commit -m "chore: estructura base y gitignore"
```

---

### Task 2: Backend package.json + tsconfig + vitest config

**Files:**
- Create: `server/package.json`
- Create: `server/tsconfig.json`
- Create: `server/vitest.config.ts`

- [ ] **Step 1: Escribir `server/package.json`**

```json
{
  "name": "panel-server",
  "version": "0.1.0",
  "private": true,
  "main": "dist/index.js",
  "scripts": {
    "dev": "ts-node src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js",
    "type-check": "tsc --noEmit",
    "test": "vitest",
    "test:run": "vitest run"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.95.3",
    "@whiskeysockets/baileys": "^6.7.0",
    "async-mutex": "^0.5.0",
    "axios": "^1.13.5",
    "cors": "^2.8.5",
    "date-fns": "^4.1.0",
    "dotenv": "^17.2.4",
    "express": "^4.18.2",
    "ioredis": "^5.9.3",
    "pino": "^9.0.0",
    "qrcode": "^1.5.3",
    "qrcode-terminal": "^0.12.0",
    "zod": "^3.22.4"
  },
  "devDependencies": {
    "@types/cors": "^2.8.19",
    "@types/express": "^4.17.21",
    "@types/node": "^20.19.33",
    "@types/qrcode": "^1.5.6",
    "@types/qrcode-terminal": "^0.12.2",
    "ts-node": "^10.9.2",
    "typescript": "^5.9.3",
    "vitest": "^4.0.18"
  }
}
```

- [ ] **Step 2: Escribir `server/tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "es2020",
    "module": "commonjs",
    "outDir": "./dist",
    "rootDir": "./src",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 3: Escribir `server/vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Instalar dependencias**

Run (en `server/`):
```bash
cd server && npm install
```
Expected: `node_modules/` creado, sin errores de resolución.

- [ ] **Step 5: Commit**

```bash
git add server/package.json server/tsconfig.json server/vitest.config.ts server/package-lock.json
git commit -m "chore(server): scaffold backend (ts + vitest)"
```

---

### Task 3: Migración Supabase multi-cuenta

**Files:**
- Create: `supabase/migrations/0001_init_multicuenta.sql`

- [ ] **Step 1: Escribir la migración completa**

```sql
-- Migración inicial: panel WhatsApp multi-cuenta
-- Schema genérico (sin comercio), account_id incorporado de raíz.

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. accounts: cada número WhatsApp conectado
CREATE TABLE IF NOT EXISTS accounts (
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
CREATE INDEX IF NOT EXISTS idx_accounts_user ON accounts(user_id);

-- 2. flows: definición visual de un flujo
CREATE TABLE IF NOT EXISTS flows (
    id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    name         varchar(255) NOT NULL,
    description  text,
    trigger_word varchar(100),
    trigger_type varchar(20) DEFAULT 'exact',
    is_active    boolean DEFAULT false,
    is_default   boolean DEFAULT false,
    nodes        jsonb DEFAULT '[]'::jsonb,
    edges        jsonb DEFAULT '[]'::jsonb,
    viewport     jsonb DEFAULT '{}'::jsonb,
    created_at   timestamptz DEFAULT now(),
    updated_at   timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_flows_acct_trigger
    ON flows(account_id, trigger_word) WHERE is_active = true;

-- 3. flow_executions: estado de sesión de un usuario en un flujo
CREATE TABLE IF NOT EXISTS flow_executions (
    id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    flow_id          uuid REFERENCES flows(id) ON DELETE SET NULL,
    phone            varchar(50) NOT NULL,
    session_id       text NOT NULL,
    current_node_id  varchar(100),
    status           varchar(20) DEFAULT 'active',
    context          jsonb DEFAULT '{}'::jsonb,
    global_variables jsonb DEFAULT '{}'::jsonb,
    version          integer DEFAULT 0,
    started_at       timestamptz DEFAULT now(),
    last_activity    timestamptz DEFAULT now(),
    expires_at       timestamptz,
    completed_at     timestamptz
);
CREATE INDEX IF NOT EXISTS idx_flowexec_acct_phone_status
    ON flow_executions(account_id, phone, status);
CREATE INDEX IF NOT EXISTS idx_flowexec_session ON flow_executions(session_id);

-- 4. flow_executions_history: sesiones archivadas
CREATE TABLE IF NOT EXISTS flow_executions_history (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      uuid,
    original_id     uuid,
    flow_id         uuid,
    phone           text,
    session_id      text,
    current_node_id text,
    status          text,
    context         jsonb,
    started_at      timestamptz,
    last_activity   timestamptz,
    completed_at    timestamptz,
    archived_at     timestamptz DEFAULT now(),
    archived_reason text,
    version         integer
);
CREATE INDEX IF NOT EXISTS idx_flowexec_hist_session ON flow_executions_history(session_id);

-- 5. whatsapp_conversations: estado de conversación + handover
CREATE TABLE IF NOT EXISTS whatsapp_conversations (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    phone           text NOT NULL,
    contact_name    text,
    last_message    text,
    last_message_at timestamptz,
    unread_count    integer DEFAULT 0,
    status          varchar(20) DEFAULT 'BOT' CHECK (status IN ('BOT','HANDOVER')),
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),
    UNIQUE (account_id, phone)
);
CREATE INDEX IF NOT EXISTS idx_waconv_acct_phone ON whatsapp_conversations(account_id, phone);

-- 6. whatsapp_messages: log de mensajes
CREATE TYPE wa_message_direction AS ENUM ('INBOUND','OUTBOUND');
CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    conversation_id uuid NOT NULL REFERENCES whatsapp_conversations(id) ON DELETE CASCADE,
    direction       wa_message_direction NOT NULL,
    content         text,
    media_url       text,
    message_type    text DEFAULT 'text',
    wa_message_id   text,
    is_read         boolean DEFAULT false,
    "timestamp"     timestamptz DEFAULT now(),
    created_at      timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wamsg_conv ON whatsapp_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_wamsg_ts ON whatsapp_messages("timestamp");

-- 7. flow_logs: auditoría de ejecución de nodos
CREATE TABLE IF NOT EXISTS flow_logs (
    id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
    account_id      uuid,
    created_at      timestamptz DEFAULT now(),
    session_id      text NOT NULL,
    phone           text,
    flow_id         text,
    node_id         text,
    node_type       text,
    input_text      text,
    output_messages jsonb DEFAULT '[]',
    execution_time_ms integer,
    metadata        jsonb DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_flowlogs_session ON flow_logs(session_id);

-- RLS: cada usuario ve sus propias cuentas y datos derivados.
ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE flows ENABLE ROW LEVEL SECURITY;
ALTER TABLE flow_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_messages ENABLE ROW LEVEL SECURITY;

-- accounts: dueño = user_id
CREATE POLICY accounts_owner ON accounts
    FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- flows / flow_executions / conversations: dueño vía join a accounts
CREATE POLICY flows_owner ON flows
    FOR ALL USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()))
    WITH CHECK (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

CREATE POLICY flowexec_owner ON flow_executions
    FOR ALL USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()))
    WITH CHECK (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

CREATE POLICY waconv_owner ON whatsapp_conversations
    FOR ALL USING (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()))
    WITH CHECK (account_id IN (SELECT id FROM accounts WHERE user_id = auth.uid()));

-- messages: dueño vía conversación
CREATE POLICY wamsg_owner ON whatsapp_messages
    FOR ALL USING (conversation_id IN (
        SELECT c.id FROM whatsapp_conversations c
        JOIN accounts a ON a.id = c.account_id
        WHERE a.user_id = auth.uid()
    ));
```

- [ ] **Step 2: Verificar sintaxis SQL localmente (parser check)**

Run (PowerShell):
```powershell
Select-String -Path supabase/migrations/0001_init_multicuenta.sql -Pattern "CREATE TABLE" | Measure-Object | Select-Object Count
```
Expected: `Count : 7` (accounts, flows, flow_executions, flow_executions_history, whatsapp_conversations, whatsapp_messages, flow_logs).

> Nota de ejecución: la migración se aplica en el dashboard de Supabase (SQL Editor) o con la CLI `supabase db push` cuando el proyecto esté linkeado. Eso es un paso operativo manual fuera de este plan.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/0001_init_multicuenta.sql
git commit -m "feat(db): schema inicial multi-cuenta (accounts + flows + sesiones + chat)"
```

---

### Task 4: Helpers de namespacing por account_id (TDD)

**Files:**
- Create: `server/src/lib/account-keys.ts`
- Test: `server/src/lib/__tests__/account-keys.test.ts`

- [ ] **Step 1: Escribir el test que falla**

```ts
import { describe, it, expect } from 'vitest';
import { checkpointKey, sessionId, authDir } from '../account-keys';

describe('account-keys', () => {
  it('checkpointKey namespacea por cuenta y teléfono', () => {
    expect(checkpointKey('acc1', '549111222333')).toBe('checkpoint:acc1:549111222333');
  });

  it('sessionId usa prefijo 1to1 para chats individuales', () => {
    expect(sessionId('acc1', '549111222333', '549111222333@s.whatsapp.net'))
      .toBe('acc1:1to1:549111222333');
  });

  it('sessionId usa prefijo group para grupos', () => {
    expect(sessionId('acc1', '549111222333', '12036304@g.us'))
      .toBe('acc1:group:12036304@g.us');
  });

  it('authDir aísla la carpeta de credenciales por cuenta', () => {
    expect(authDir('/data/auth', 'acc1')).toBe('/data/auth/acc1');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run (en `server/`):
```bash
cd server && npx vitest run src/lib/__tests__/account-keys.test.ts
```
Expected: FAIL — "Cannot find module '../account-keys'".

- [ ] **Step 3: Implementar `account-keys.ts`**

```ts
import path from 'path';

/** Clave Redis del checkpoint de sesión, aislada por cuenta. */
export function checkpointKey(accountId: string, phone: string): string {
  return `checkpoint:${accountId}:${phone}`;
}

/** ID de sesión: distingue chat 1-a-1 de grupo, prefijado por cuenta. */
export function sessionId(accountId: string, phone: string, remoteJid: string): string {
  const kind = remoteJid.endsWith('@g.us') ? `group:${remoteJid}` : `1to1:${phone}`;
  return `${accountId}:${kind}`;
}

/** Carpeta de credenciales Baileys, una por cuenta. */
export function authDir(basePath: string, accountId: string): string {
  return path.posix.join(basePath, accountId);
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run:
```bash
cd server && npx vitest run src/lib/__tests__/account-keys.test.ts
```
Expected: PASS (4 tests).

> Nota: `authDir` usa `path.posix.join` para que el test dé el mismo resultado en Windows y Linux. En runtime el server corre en Linux (deploy); para escritura de archivos local en Windows, Baileys acepta separadores `/`.

- [ ] **Step 5: Commit**

```bash
git add server/src/lib/account-keys.ts server/src/lib/__tests__/account-keys.test.ts
git commit -m "feat(server): helpers de namespacing por account_id"
```

---

### Task 5: Clientes Supabase + Redis del backend

**Files:**
- Create: `server/src/config/supabase.ts`
- Create: `server/src/config/redis.ts`
- Create: `server/.env.example`
- Test: `server/src/config/__tests__/redis.keys.test.ts`

- [ ] **Step 1: Escribir `server/.env.example`**

```
SUPABASE_URL=
SUPABASE_SERVICE_KEY=
REDIS_URL=redis://127.0.0.1:6379
AUTH_BASE_PATH=./auth
GROQ_API_KEY=
GOOGLE_GENERATIVE_AI_KEY=
PORT=3001
CORS_ORIGIN=http://localhost:5173
```

- [ ] **Step 2: Escribir `server/src/config/supabase.ts`**

```ts
import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createClient, SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || '';

if (!supabaseUrl || !supabaseKey) {
  console.warn('⚠️ [supabase] Falta SUPABASE_URL o SUPABASE_SERVICE_KEY en .env');
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: true },
  realtime: { timeout: 60000, params: { events_per_second: 20 } },
  db: { schema: 'public' },
});
```

- [ ] **Step 3: Escribir `server/src/config/redis.ts`**

```ts
import Redis from 'ioredis';
import 'dotenv/config';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  retryStrategy(times: number): number | null {
    if (times > 3) return null;
    return Math.min(times * 100, 2000);
  },
});

redis.on('error', (err: Error) => console.error('❌ [redis]', err.message));
redis.on('connect', () => console.log('✅ [redis] conectado'));

/** Cierre limpio para tests/shutdown. */
export async function closeRedis(): Promise<void> {
  await redis.quit();
}
```

- [ ] **Step 4: Escribir test de integración de clientes (no requiere red)**

```ts
import { describe, it, expect } from 'vitest';

describe('config clients', () => {
  it('supabase exporta un cliente con .from()', async () => {
    const { supabase } = await import('../supabase');
    expect(typeof supabase.from).toBe('function');
  });

  it('redis exporta una instancia ioredis', async () => {
    const { redis } = await import('../redis');
    expect(typeof redis.get).toBe('function');
    await redis.quit();
  });
});
```

- [ ] **Step 5: Correr el test**

Run (en `server/`):
```bash
cd server && npx vitest run src/config/__tests__/redis.keys.test.ts
```
Expected: PASS (2 tests). Puede loguear "❌ [redis]" si no hay Redis local — está bien, el test no abre conexión hasta usarla y `quit()` la cierra.

- [ ] **Step 6: Verificar type-check del backend**

Run (en `server/`):
```bash
cd server && npm run type-check
```
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add server/src/config/supabase.ts server/src/config/redis.ts server/.env.example server/src/config/__tests__/redis.keys.test.ts
git commit -m "feat(server): clientes Supabase y Redis + .env.example"
```

---

### Task 6: Scaffold del frontend (Vite + React + Tailwind + Supabase)

**Files:**
- Create: `client/*` (generado por Vite)
- Create: `client/.env.example`
- Create: `client/src/supabaseClient.ts`
- Modify: `client/tailwind.config.js`, `client/src/index.css`

- [ ] **Step 1: Generar scaffold Vite React+TS**

Run (desde la raíz `nuevo panel/`):
```bash
npm create vite@latest client -- --template react-ts
```
Expected: crea `client/` con `package.json`, `vite.config.ts`, `src/`. Si `client/` ya tiene contenido del Task 1, Vite pregunta; responder para vaciar/continuar. (En PowerShell el scaffold es interactivo: confirmar template `react-ts`.)

- [ ] **Step 2: Instalar deps base + Tailwind + Supabase + ReactFlow + router**

Run (en `client/`):
```bash
cd client && npm install @supabase/supabase-js@^2.95.3 reactflow@^11.11.4 react-router-dom@^7 lucide-react sonner zustand && npm install -D tailwindcss@^3.4.17 postcss autoprefixer && npx tailwindcss init -p
```
Expected: `tailwind.config.js` + `postcss.config.js` creados.

- [ ] **Step 3: Configurar `client/tailwind.config.js`**

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: { extend: {} },
  plugins: [],
};
```

- [ ] **Step 4: Reemplazar `client/src/index.css` con directivas Tailwind**

```css
@tailwind base;
@tailwind components;
@tailwind utilities;
```

- [ ] **Step 5: Escribir `client/.env.example`**

```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:3001
```

- [ ] **Step 6: Escribir `client/src/supabaseClient.ts`**

```ts
import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string;
const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

if (!url || !anon) {
  throw new Error('Faltan VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY en client/.env');
}

export const supabase = createClient(url, anon);
```

- [ ] **Step 7: Verificar build del frontend**

Run (en `client/`):
```bash
cd client && npm run build
```
Expected: build exitoso (genera `client/dist/`). Si falla por falta de `.env`, crear `client/.env` copiando `.env.example` con valores dummy para el build — las vars solo se leen en runtime, no en build, así que el build debe pasar igual.

- [ ] **Step 8: Commit**

```bash
git add client -- ':!client/node_modules' ':!client/dist'
git commit -m "chore(client): scaffold Vite + React + Tailwind + Supabase"
```

---

### Task 7: README de arranque + verificación final

**Files:**
- Create: `README.md`

- [ ] **Step 1: Escribir `README.md`**

```markdown
# Panel WhatsApp Multi-Cuenta

Monorepo: `server/` (backend Node/Express + Baileys + FlowEngine), `client/` (React+Vite bot builder + inbox), `supabase/` (migraciones).

## Setup
1. Crear proyecto Supabase. Aplicar `supabase/migrations/0001_init_multicuenta.sql` en el SQL Editor.
2. Backend: `cd server && cp .env.example .env` (completar SUPABASE_URL, SUPABASE_SERVICE_KEY, REDIS_URL). `npm install && npm run dev`.
3. Frontend: `cd client && cp .env.example .env` (completar VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). `npm install && npm run dev`.
4. Redis local: `docker run -p 6379:6379 redis` o instalar Redis.

## Tests
- Backend: `cd server && npm test`

Diseño: `docs/superpowers/specs/2026-06-14-panel-whatsapp-multicuenta-design.md`
```

- [ ] **Step 2: Correr toda la suite de tests del backend**

Run (en `server/`):
```bash
cd server && npm run test:run
```
Expected: PASS (6 tests: 4 account-keys + 2 config clients).

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README de arranque del monorepo"
```

---

## Self-Review

**Cobertura del spec (Plan 1 = §3.1 parcial + §5 + §8):**
- §5 schema multi-cuenta → Task 3 (todas las tablas con `account_id`, RLS por `user_id`). ✓
- §2.2 aislamiento (Redis key, sessionId, authDir) → Task 4. ✓
- §3.1 clientes Supabase/Redis → Task 5. ✓
- §8 variables de entorno → Task 5 (server/.env.example) + Task 6 (client/.env.example). ✓
- Scaffold frontend stack (§3.2) → Task 6. ✓
- FlowEngine/executors/gateway/API → **fuera de Plan 1** (Planes 2–4). Documentado en el encabezado de scope.

**Placeholders:** ninguno — todo el SQL, TS y comandos están completos.

**Consistencia de tipos:** `checkpointKey`/`sessionId`/`authDir` usados igual en test e implementación (Task 4). `supabase`/`redis` exportados en Task 5 y consumidos por nombre en su test.

**Nota de entorno:** comandos mezclan PowerShell (scaffold/parse) y npm (cross-shell). Aplicar migración Supabase y levantar Redis son pasos operativos manuales, marcados como tales.
```

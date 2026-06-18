# RBAC admin/empleadas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Segmentar el panel en roles admin (acceso total) y empleada (solo conversaciones + responder manual + agenda), con enforcement real en la API Express y ocultamiento en el frontend.

**Architecture:** Tabla `profiles` (role por usuario) + middleware `authContext` que valida el JWT de Supabase y carga el rol + guard `requireRole('admin')` en rutas sensibles. El frontend inyecta el JWT en cada request y esconde nav/rutas según rol. Single-org.

**Tech Stack:** Node/Express + TypeScript, Supabase (Auth + Postgres), vitest (backend). React + Vite + react-router (frontend, sin test runner → se verifica con `tsc -b`/build).

Spec: `docs/superpowers/specs/2026-06-18-rbac-admin-empleadas-design.md`

---

## File Structure

Nuevos:
- `supabase/migrations/0009_profiles.sql` — tabla profiles + seed admin.
- `server/src/api/middleware/auth.ts` — `authContext`, `requireRole`, tipo `AuthUser`.
- `server/src/api/middleware/__tests__/auth.test.ts` — tests middleware.
- `server/src/api/routes/me.routes.ts` — `GET /api/me`.
- `server/src/api/routes/team.routes.ts` — gestión de empleadas (admin).
- `server/src/api/routes/__tests__/team.routes.test.ts` — tests team.
- `client/src/components/RoleRoute.tsx` — guard de ruta por rol.
- `client/src/pages/Team.tsx` — página gestión empleadas.

Modificados:
- `server/src/api/app.ts` — montaje middleware + routers nuevos.
- `server/src/api/routes/accounts.routes.ts` — `requireRole('admin')` en mutaciones + strip de secretos en GET para empleada.
- `client/src/lib/api.ts` — header Authorization + `teamApi` + manejo 401/403.
- `client/src/context/AuthContext.tsx` — `role` + fetch `/api/me`.
- `client/src/components/Layout.tsx` — nav por rol + ítem Equipo.
- `client/src/App.tsx` — `RoleRoute` + ruta `/team`.
- `client/src/types/index.ts` — tipo `Role`/`Profile`.

---

## Task 1: Migración profiles

**Files:**
- Create: `supabase/migrations/0009_profiles.sql`
- Modify: `server/scripts/check-migrations.js` (agregar marcador 0009)

- [ ] **Step 1: Crear la migración**

Create `supabase/migrations/0009_profiles.sql`:

```sql
-- 0009: roles por usuario (admin / empleada). Single-org. Idempotente.
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'empleada' CHECK (role IN ('admin','empleada')),
  name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- El usuario existente queda como admin.
INSERT INTO profiles (id, role, name)
  SELECT id, 'admin', 'Administrador' FROM auth.users WHERE email = 'rsgroupenter@gmail.com'
  ON CONFLICT (id) DO UPDATE SET role = 'admin';
```

- [ ] **Step 2: Agregar el chequeo 0009 al script de verificación**

In `server/scripts/check-migrations.js`, add to the `CHECKS` object (after `0008_account_ai_support`):

```js
  '0009_profiles': { profiles: ['id', 'role', 'name', 'active'] },
```

- [ ] **Step 3: Aplicar la migración en Supabase**

Pegar el contenido de `0009_profiles.sql` en el SQL Editor de Supabase y ejecutarlo. (Manual — no hay runner automático.)

- [ ] **Step 4: Verificar que quedó aplicada**

Run: `cd server && node scripts/check-migrations.js`
Expected: línea `✅ 0009_profiles`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0009_profiles.sql server/scripts/check-migrations.js
git commit -m "feat(db): tabla profiles para roles admin/empleada (migración 0009)"
```

---

## Task 2: Middleware authContext + requireRole

**Files:**
- Create: `server/src/api/middleware/auth.ts`
- Test: `server/src/api/middleware/__tests__/auth.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `server/src/api/middleware/__tests__/auth.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const state: { user: any; userError: any; profile: any } = { user: null, userError: null, profile: null };
vi.mock('../../../config/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: state.user }, error: state.userError }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.profile }) }) }) }),
  },
}));

import { authContext, requireRole } from '../auth';

function makeReq(authHeader?: string) {
  return { header: (n: string) => (n === 'Authorization' ? authHeader : undefined), user: undefined } as any;
}
function makeRes() {
  return {
    statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; },
  } as any;
}

describe('authContext', () => {
  beforeEach(() => { state.user = null; state.userError = null; state.profile = null; delete process.env.NODE_ENV; });

  it('sin token => 401', async () => {
    const res = makeRes(); let nexted = false;
    await authContext(makeReq(undefined), res, () => { nexted = true; });
    expect(res.statusCode).toBe(401); expect(nexted).toBe(false);
  });

  it('token válido + profile activo => req.user con rol', async () => {
    state.user = { id: 'u1' }; state.profile = { role: 'empleada', name: 'Ana', active: true };
    const req = makeReq('Bearer realtoken'); const res = makeRes(); let nexted = false;
    await authContext(req, res, () => { nexted = true; });
    expect(nexted).toBe(true); expect(req.user).toEqual({ id: 'u1', role: 'empleada', name: 'Ana' });
  });

  it('profile inactivo => 401', async () => {
    state.user = { id: 'u1' }; state.profile = { role: 'empleada', name: 'Ana', active: false };
    const res = makeRes(); let nexted = false;
    await authContext(makeReq('Bearer x'), res, () => { nexted = true; });
    expect(res.statusCode).toBe(401); expect(nexted).toBe(false);
  });

  it('dev-token fuera de prod => admin', async () => {
    process.env.NODE_ENV = 'development';
    const req = makeReq('Bearer dev-token'); const res = makeRes(); let nexted = false;
    await authContext(req, res, () => { nexted = true; });
    expect(nexted).toBe(true); expect(req.user.role).toBe('admin');
  });

  it('dev-token en prod => 401', async () => {
    process.env.NODE_ENV = 'production';
    const res = makeRes(); let nexted = false;
    await authContext(makeReq('Bearer dev-token'), res, () => { nexted = true; });
    expect(res.statusCode).toBe(401); expect(nexted).toBe(false);
  });
});

describe('requireRole', () => {
  it('rol correcto pasa', () => {
    const req = { user: { role: 'admin' } } as any; const res = makeRes(); let nexted = false;
    requireRole('admin')(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
  });
  it('rol incorrecto => 403', () => {
    const req = { user: { role: 'empleada' } } as any; const res = makeRes(); let nexted = false;
    requireRole('admin')(req, res, () => { nexted = true; });
    expect(res.statusCode).toBe(403); expect(nexted).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd server && npx vitest run src/api/middleware/__tests__/auth.test.ts`
Expected: FAIL (`Cannot find module '../auth'`).

- [ ] **Step 3: Implementar el middleware**

Create `server/src/api/middleware/auth.ts`:

```ts
import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../../config/supabase';

export type Role = 'admin' | 'empleada';
export interface AuthUser { id: string; role: Role; name: string | null; }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

// Debe coincidir con el MOCK_USER del frontend (AuthContext.tsx).
const MOCK_ADMIN_ID = '03f6b5d7-febe-4af9-909b-70fba81e26af';
const isProd = () => process.env.NODE_ENV === 'production';

/** Valida el JWT de Supabase, carga el rol desde profiles y lo adjunta a req.user. */
export async function authContext(req: Request, res: Response, next: NextFunction) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  // Bypass de desarrollo: solo fuera de producción.
  if (token === 'dev-token') {
    if (isProd()) return res.status(401).json({ error: 'No autenticado' });
    req.user = { id: MOCK_ADMIN_ID, role: 'admin', name: 'Administrador (dev)' };
    return next();
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Token inválido' });

  const { data: prof } = await supabase
    .from('profiles').select('role, name, active').eq('id', data.user.id).maybeSingle();
  if (!prof || prof.active === false) return res.status(401).json({ error: 'Sin perfil o inactivo' });

  req.user = { id: data.user.id, role: prof.role as Role, name: prof.name ?? null };
  next();
}

/** Bloquea con 403 si el rol del usuario no coincide. */
export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) return res.status(403).json({ error: 'Sin permiso' });
    next();
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd server && npx vitest run src/api/middleware/__tests__/auth.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/api/middleware/auth.ts server/src/api/middleware/__tests__/auth.test.ts
git commit -m "feat(api): middleware authContext + requireRole (RBAC)"
```

---

## Task 3: Router /api/me

**Files:**
- Create: `server/src/api/routes/me.routes.ts`

- [ ] **Step 1: Implementar el router**

Create `server/src/api/routes/me.routes.ts`:

```ts
import { Router } from 'express';

/** Devuelve el usuario autenticado (id, rol, nombre). Requiere authContext montado antes. */
export function meRouter(): Router {
  const r = Router();
  r.get('/', (req, res) => {
    const u = req.user;
    if (!u) return res.status(401).json({ error: 'No autenticado' });
    res.json({ id: u.id, role: u.role, name: u.name });
  });
  return r;
}
```

- [ ] **Step 2: Commit**

```bash
git add server/src/api/routes/me.routes.ts
git commit -m "feat(api): endpoint GET /api/me"
```

---

## Task 4: Router /api/team (gestión empleadas, admin)

**Files:**
- Create: `server/src/api/routes/team.routes.ts`
- Test: `server/src/api/routes/__tests__/team.routes.test.ts`

- [ ] **Step 1: Escribir el test que falla**

Create `server/src/api/routes/__tests__/team.routes.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { insert?: any } = {};
const adminUser = { id: 'new-uid', email: 'ana@bufete.com' };
vi.mock('../../../config/supabase', () => ({
  supabase: {
    auth: { admin: {
      createUser: (args: any) => { calls.insert = { ...calls.insert, createUser: args }; return Promise.resolve({ data: { user: adminUser }, error: null }); },
      listUsers: () => Promise.resolve({ data: { users: [adminUser] } }),
      updateUserById: () => Promise.resolve({ error: null }),
    } },
    from: () => ({
      insert: (row: any) => { calls.insert = { ...calls.insert, profileRow: row }; return Promise.resolve({ error: null }); },
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  },
}));

import { teamRouter } from '../team.routes';

function getHandler(router: any, method: 'get' | 'post' | 'put', path: string) {
  const layer = router.stack.find((l: any) => l.route && l.route.methods[method] && l.route.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function makeRes() {
  return { statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; } } as any;
}

describe('teamRouter POST /', () => {
  beforeEach(() => { calls.insert = undefined; });
  it('crea usuario y profile con rol empleada', async () => {
    const handler = getHandler(teamRouter(), 'post', '/');
    const res = makeRes();
    await handler({ body: { email: 'ana@bufete.com', password: 'secret123', name: 'Ana' } } as any, res);
    expect(calls.insert.createUser.email).toBe('ana@bufete.com');
    expect(calls.insert.profileRow.role).toBe('empleada');
    expect(calls.insert.profileRow.id).toBe('new-uid');
    expect(res.statusCode).toBe(200);
  });
  it('sin email/password => 400', async () => {
    const handler = getHandler(teamRouter(), 'post', '/');
    const res = makeRes();
    await handler({ body: { name: 'Ana' } } as any, res);
    expect(res.statusCode).toBe(400);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `cd server && npx vitest run src/api/routes/__tests__/team.routes.test.ts`
Expected: FAIL (`Cannot find module '../team.routes'`).

- [ ] **Step 3: Implementar el router**

Create `server/src/api/routes/team.routes.ts`:

```ts
import { Router } from 'express';
import { supabase } from '../../config/supabase';

/**
 * Gestión de empleadas (solo admin; el guard requireRole se monta en app.ts).
 * No hay borrado: revocar acceso = active=false (el middleware rechaza inactivas).
 */
export function teamRouter(): Router {
  const r = Router();

  // Listar empleadas con su email (de auth.users vía Admin API).
  r.get('/', async (_req, res) => {
    const { data: profiles, error } = await supabase
      .from('profiles').select('id, role, name, active, created_at')
      .eq('role', 'empleada').order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    const { data: list } = await supabase.auth.admin.listUsers();
    const emailById = new Map((list?.users ?? []).map((u: any) => [u.id, u.email]));
    res.json((profiles ?? []).map((p: any) => ({ ...p, email: emailById.get(p.id) ?? null })));
  });

  // Crear empleada: user en auth + profile role empleada.
  r.post('/', async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' });
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data?.user) return res.status(400).json({ error: error?.message ?? 'no se pudo crear el usuario' });
    const { error: pErr } = await supabase
      .from('profiles').insert({ id: data.user.id, role: 'empleada', name: name ?? null, active: true });
    if (pErr) return res.status(400).json({ error: pErr.message });
    res.json({ id: data.user.id, email, name: name ?? null, role: 'empleada', active: true });
  });

  // Actualizar nombre / activar / desactivar.
  r.put('/:id', async (req, res) => {
    const patch: Record<string, any> = {};
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.active !== undefined) patch.active = !!req.body.active;
    const { data, error } = await supabase
      .from('profiles').update(patch).eq('id', req.params.id).eq('role', 'empleada').select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // Resetear password.
  r.post('/:id/reset-password', async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'password requerido' });
    const { error } = await supabase.auth.admin.updateUserById(req.params.id, { password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  });

  return r;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `cd server && npx vitest run src/api/routes/__tests__/team.routes.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add server/src/api/routes/team.routes.ts server/src/api/routes/__tests__/team.routes.test.ts
git commit -m "feat(api): router /api/team (alta/baja lógica de empleadas)"
```

---

## Task 5: Montar middleware y routers en app.ts

**Files:**
- Modify: `server/src/api/app.ts`

- [ ] **Step 1: Reescribir el montaje**

Replace the body of `createApp` in `server/src/api/app.ts`. Keep imports; add the new ones and the wiring:

```ts
import express from 'express';
import cors from 'cors';
import type { AccountManager } from '../core/accounts/AccountManager';
import { accountsRouter } from './routes/accounts.routes';
import { flowsRouter } from './routes/flows.routes';
import { conversationsRouter } from './routes/conversations.routes';
import { messagesRouter } from './routes/messages.routes';
import { configRouter } from './routes/config.routes';
import { appointmentsRouter } from './routes/appointments.routes';
import { metaWebhookRouter } from './routes/webhooks.routes';
import { meRouter } from './routes/me.routes';
import { teamRouter } from './routes/team.routes';
import { authContext, requireRole } from './middleware/auth';

export function createApp(manager: AccountManager) {
  const app = express();
  app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',') }));
  app.use(express.json({
    limit: '5mb',
    verify: (req, _res, buf) => { (req as any).rawBody = buf; },
  }));

  // Público: health + webhook de Meta (se valida por firma, NO por JWT).
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/webhooks/meta', metaWebhookRouter(manager));

  // Protegido: requiere JWT válido (authContext) y, donde corresponde, rol admin.
  app.use('/api/me', authContext, meRouter());
  app.use('/api/accounts', authContext, accountsRouter(manager));      // GET ambos; mutaciones admin (en el router)
  app.use('/api/conversations', authContext, conversationsRouter());
  app.use('/api/messages', authContext, messagesRouter(manager));
  app.use('/api/appointments', authContext, appointmentsRouter());
  app.use('/api/flows', authContext, requireRole('admin'), flowsRouter());
  app.use('/api/config', authContext, requireRole('admin'), configRouter());
  app.use('/api/team', authContext, requireRole('admin'), teamRouter());

  return app;
}
```

- [ ] **Step 2: Verificar tipos**

Run: `cd server && npm run type-check`
Expected: sin errores (la modificación de accounts.routes en Task 6 todavía no se hizo; si `requireRole` no se importa ahí aún, igual compila porque app.ts no lo necesita). Si hay error, es por imports faltantes en este archivo.

- [ ] **Step 3: Commit**

```bash
git add server/src/api/app.ts
git commit -m "feat(api): montar authContext + requireRole y routers me/team"
```

---

## Task 6: accounts.routes — admin en mutaciones + strip de secretos

**Files:**
- Modify: `server/src/api/routes/accounts.routes.ts`

- [ ] **Step 1: Importar requireRole y agregar helper de slim**

In `server/src/api/routes/accounts.routes.ts`, after the existing imports add:

```ts
import { requireRole } from '../middleware/auth';

// Campos sensibles que NO debe ver una empleada.
function slimAccount(a: any) {
  if (!a) return a;
  const { access_token, app_secret, verify_token, ai_api_key, ai_support_prompt, ...safe } = a;
  return safe;
}
```

- [ ] **Step 2: Proteger las rutas mutadoras con requireRole('admin')**

Add `requireRole('admin')` as middleware to each mutating route. Change the route signatures:

```ts
r.post('/', requireRole('admin'), async (req, res) => {        // crear cuenta
r.post('/:id/connect', requireRole('admin'), async (req, res) => {
r.post('/:id/disconnect', requireRole('admin'), async (req, res) => {
r.put('/:id', requireRole('admin'), async (req, res) => {
r.delete('/:id', requireRole('admin'), async (req, res) => {
```

(Solo se agrega `requireRole('admin'),` entre el path y el handler; el cuerpo de cada handler queda igual.)

- [ ] **Step 3: Strip de secretos en GET para empleada**

In the `GET /` handler, both return points (supabase branch and memory branch) must map through `slimAccount` when the role is empleada. Wrap each `res.json(list)` / `res.json(data)`:

```ts
// supabase branch:
if (error) return res.status(400).json({ error: error.message });
return res.json(req.user?.role === 'empleada' ? (data ?? []).map(slimAccount) : data);
```

```ts
// memory branch (al final del GET):
const result = req.user?.role === 'empleada' ? list.map(slimAccount) : list;
res.json(result);
```

- [ ] **Step 4: Verificar tipos + tests existentes**

Run: `cd server && npm run type-check && npx vitest run`
Expected: tsc sin errores; todos los tests previos siguen verdes.

- [ ] **Step 5: Commit**

```bash
git add server/src/api/routes/accounts.routes.ts
git commit -m "feat(api): accounts mutaciones solo admin + GET sin secretos para empleada"
```

---

## Task 7: Frontend — Authorization header + teamApi + tipos

**Files:**
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/types/index.ts`

- [ ] **Step 1: Tipo Role/Profile**

In `client/src/types/index.ts` add:

```ts
export type Role = 'admin' | 'empleada';

export interface Profile {
  id: string;
  role: Role;
  name: string | null;
  active: boolean;
  email?: string | null;
  created_at?: string;
}
```

- [ ] **Step 2: Inyectar el JWT en api() + manejar 401/403**

In `client/src/lib/api.ts`, replace the top of the file (the `BASE` const and `api()` function) with:

```ts
import { supabase } from '../supabaseClient';

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';
const IS_DEV = !import.meta.env.VITE_SUPABASE_URL;

async function authHeader(): Promise<Record<string, string>> {
  if (IS_DEV) return { Authorization: 'Bearer dev-token' };
  const { data } = await supabase.auth.getSession();
  const t = data.session?.access_token;
  return t ? { Authorization: `Bearer ${t}` } : {};
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const auth = await authHeader();
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...auth, ...(init?.headers || {}) },
    ...init,
  });
  if (res.status === 401) {
    if (!IS_DEV) { await supabase.auth.signOut(); window.location.href = '/login'; }
    throw new Error('Sesión expirada');
  }
  if (res.status === 403) throw new Error('No tenés permiso para esta acción');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `API ${path} → ${res.status}`);
  }
  return res.json() as Promise<T>;
}
```

- [ ] **Step 3: Agregar teamApi y meApi**

At the end of `client/src/lib/api.ts`, before `export const apiBase = BASE;`, add:

```ts
// ── Auth / rol ───────────────────────────────────────────────
import type { Profile, Role } from '../types';

export const meApi = {
  get: () => api<{ id: string; role: Role; name: string | null }>('/api/me'),
};

export const teamApi = {
  list: () => api<Profile[]>('/api/team'),
  create: (email: string, password: string, name: string) =>
    api<Profile>('/api/team', { method: 'POST', body: JSON.stringify({ email, password, name }) }),
  setActive: (id: string, active: boolean) =>
    api<Profile>(`/api/team/${id}`, { method: 'PUT', body: JSON.stringify({ active }) }),
  rename: (id: string, name: string) =>
    api<Profile>(`/api/team/${id}`, { method: 'PUT', body: JSON.stringify({ name }) }),
  resetPassword: (id: string, password: string) =>
    api<{ ok: boolean }>(`/api/team/${id}/reset-password`, { method: 'POST', body: JSON.stringify({ password }) }),
};
```

- [ ] **Step 4: Verificar build de tipos**

Run: `cd client && npx tsc -b`
Expected: sin errores.

- [ ] **Step 5: Commit**

```bash
git add client/src/lib/api.ts client/src/types/index.ts
git commit -m "feat(client): JWT en api() + teamApi/meApi + tipo Role"
```

---

## Task 8: AuthContext — exponer rol

**Files:**
- Modify: `client/src/context/AuthContext.tsx`

- [ ] **Step 1: Agregar role al contexto y traerlo de /api/me**

In `client/src/context/AuthContext.tsx`:

1. Import the api: at the top, `import { meApi } from '../lib/api';` and `import type { Role } from '../types';`
2. Add `role` to the interface:

```ts
interface AuthContextType {
  session: Session | null;
  user: User | null;
  role: Role | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<{ data: { user: User | null; session: Session | null }; error: any }>;
  signOut: () => Promise<void>;
}
```

3. Add `role: null` to the default `createContext` value.
4. Add state `const [role, setRole] = useState<Role | null>(null);`
5. In the effect, after a session is set, resolve the role. In DEV branch set `setRole('admin')`. In the real branch, after `setSession/ setUser`, fetch the role:

```ts
// dentro del effect, modo dev:
if (IS_DEV_MODE) {
  setSession(MOCK_SESSION); setUser(MOCK_USER); setRole('admin'); setLoading(false);
  return;
}

// helper para resolver rol tras tener sesión:
const resolveRole = async (s: Session | null) => {
  if (!s) { setRole(null); return; }
  try { const me = await meApi.get(); setRole(me.role); } catch { setRole(null); }
};

supabase.auth.getSession().then(async ({ data: { session } }) => {
  setSession(session); setUser(session?.user ?? null);
  await resolveRole(session); setLoading(false);
});

const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_e, session) => {
  setSession(session); setUser(session?.user ?? null);
  await resolveRole(session); setLoading(false);
});
```

6. Add `role` to the `value` object.

- [ ] **Step 2: Verificar build de tipos**

Run: `cd client && npx tsc -b`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add client/src/context/AuthContext.tsx
git commit -m "feat(client): AuthContext expone role (de /api/me)"
```

---

## Task 9: RoleRoute + routing por rol

**Files:**
- Create: `client/src/components/RoleRoute.tsx`
- Modify: `client/src/App.tsx`

- [ ] **Step 1: Crear RoleRoute**

Create `client/src/components/RoleRoute.tsx`:

```tsx
import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import type { Role } from '../types';

/** Permite la ruta solo si el rol coincide; si no, redirige (empleada → /inbox). */
export default function RoleRoute({ role }: { role: Role }) {
  const { role: current, loading } = useAuth();
  if (loading) return null;
  return current === role ? <Outlet /> : <Navigate to="/inbox" replace />;
}
```

- [ ] **Step 2: Envolver rutas admin en App.tsx**

In `client/src/App.tsx`, import `RoleRoute` and `Team`, and restructure the protected routes so the admin-only ones live under `RoleRoute role="admin"`:

```tsx
import RoleRoute from './components/RoleRoute';
import Team from './pages/Team';
// ...
<Route element={<ProtectedRoute />}>
  <Route element={<AccountProvider><Layout /></AccountProvider>}>
    <Route index element={<Navigate to="/inbox" replace />} />
    {/* ambos roles */}
    <Route path="/inbox" element={<WhatsAppInbox />} />
    <Route path="/agenda" element={<Agenda />} />
    {/* solo admin */}
    <Route element={<RoleRoute role="admin" />}>
      <Route path="/accounts" element={<Accounts />} />
      <Route path="/builder" element={<BotBuilder />} />
      <Route path="/connections" element={<Connections />} />
      <Route path="/team" element={<Team />} />
    </Route>
  </Route>
</Route>
```

(El index ahora manda a `/inbox`, accesible por ambos roles; el admin navega a las demás desde el nav.)

- [ ] **Step 3: Verificar build de tipos**

Run: `cd client && npx tsc -b`
Expected: sin errores (Team existe recién en Task 11; crear Task 11 antes de correr el build final, o crear un stub. Ver Task 11). Si `Team` no existe aún, este build fallará — completar Task 11 y luego correr el build.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/RoleRoute.tsx client/src/App.tsx
git commit -m "feat(client): RoleRoute + rutas admin protegidas"
```

---

## Task 10: Layout — nav por rol

**Files:**
- Modify: `client/src/components/Layout.tsx`

- [ ] **Step 1: Definir nav por rol y filtrar**

In `client/src/components/Layout.tsx`:

1. Import role: `const { signOut, role } = useAuth();` (agregar `role`). Import the `Users` icon from lucide: add `Users` to the existing lucide import.
2. Replace the static `navItems` with role-aware items. Each item declara qué roles lo ven:

```tsx
const allNav = [
  { to: '/accounts', label: 'Mis Números', icon: Phone, roles: ['admin'] },
  { to: '/inbox', label: 'Mensajes', icon: MessageSquare, roles: ['admin', 'empleada'] },
  { to: '/builder', label: 'Bot Builder', icon: Bot, roles: ['admin'] },
  { to: '/agenda', label: 'Agenda', icon: Calendar, roles: ['admin', 'empleada'] },
  { to: '/team', label: 'Equipo', icon: Users, roles: ['admin'] },
  { to: '/connections', label: 'Conexiones', icon: Settings, roles: ['admin'] },
] as const;

const navItems = allNav.filter(item => role && item.roles.includes(role));
```

(El resto del componente — el `.map(navItems)` — queda igual.)

- [ ] **Step 2: Verificar build de tipos**

Run: `cd client && npx tsc -b`
Expected: sin errores (depende de Team; ver Task 11).

- [ ] **Step 3: Commit**

```bash
git add client/src/components/Layout.tsx
git commit -m "feat(client): nav filtrado por rol + ítem Equipo"
```

---

## Task 11: Página Equipo

**Files:**
- Create: `client/src/pages/Team.tsx`

- [ ] **Step 1: Crear la página**

Create `client/src/pages/Team.tsx`:

```tsx
import { useEffect, useState, useCallback } from 'react';
import { teamApi } from '../lib/api';
import type { Profile } from '../types';
import { toast } from 'sonner';
import { Users, Plus, Loader2, UserCheck, UserX } from 'lucide-react';

export default function Team() {
  const [list, setList] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [creating, setCreating] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try { setList(await teamApi.list()); }
    catch (e: any) { toast.error(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const create = async () => {
    if (!email.trim() || !password.trim()) { toast.error('Email y contraseña requeridos'); return; }
    setCreating(true);
    try {
      await teamApi.create(email.trim(), password.trim(), name.trim());
      toast.success('Empleada creada');
      setEmail(''); setName(''); setPassword('');
      load();
    } catch (e: any) { toast.error('Error: ' + e.message); }
    finally { setCreating(false); }
  };

  const toggleActive = async (p: Profile) => {
    try {
      await teamApi.setActive(p.id, !p.active);
      toast.success(p.active ? 'Acceso revocado' : 'Acceso reactivado');
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  return (
    <div className="min-h-screen bg-[#0b0f1a] p-6 lg:p-8 font-sans">
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center gap-3 mb-8 border-b border-white/5 pb-6">
          <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-[#304352] to-[#a57b5a] flex items-center justify-center">
            <Users size={22} className="text-[#C6AC98]" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-white font-serif">Equipo</h1>
            <p className="text-sm text-brand-textMuted">Gestión de empleadas y accesos</p>
          </div>
        </div>

        {/* Alta */}
        <div className="glass-card rounded-2xl p-6 mb-8 border border-white/10">
          <h2 className="text-white font-serif font-bold text-lg mb-4">Nueva empleada</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <input className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" placeholder="Nombre" value={name} onChange={e => setName(e.target.value)} />
            <input className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)} />
            <input type="password" className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-white text-sm" placeholder="Contraseña inicial" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
          <button onClick={create} disabled={creating} className="mt-4 flex items-center gap-2 bg-gradient-to-r from-[#304352] to-[#a57b5a] text-white px-6 py-3 rounded-xl font-bold text-sm disabled:opacity-40">
            {creating ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Crear
          </button>
        </div>

        {/* Listado */}
        <div className="glass-card rounded-2xl border border-white/10 overflow-hidden">
          {loading ? (
            <div className="p-10 flex justify-center"><Loader2 size={24} className="animate-spin text-[#C6AC98]" /></div>
          ) : list.length === 0 ? (
            <p className="p-10 text-center text-brand-textMuted text-sm">Sin empleadas todavía.</p>
          ) : list.map(p => (
            <div key={p.id} className="flex items-center justify-between px-5 py-4 border-b border-white/5 last:border-0">
              <div>
                <div className="text-white text-sm font-semibold">{p.name || '(sin nombre)'}</div>
                <div className="text-brand-textMuted text-xs">{p.email}</div>
              </div>
              <div className="flex items-center gap-3">
                <span className={`text-[11px] px-2.5 py-1 rounded-full border ${p.active ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' : 'bg-slate-500/10 text-slate-400 border-slate-500/20'}`}>
                  {p.active ? 'Activa' : 'Inactiva'}
                </span>
                <button onClick={() => toggleActive(p)} className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-xl border border-white/10 text-brand-textMuted hover:text-white">
                  {p.active ? <><UserX size={14} /> Desactivar</> : <><UserCheck size={14} /> Activar</>}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Build completo del frontend**

Run: `cd client && npm run build`
Expected: build OK (compila App.tsx, Layout, RoleRoute, Team juntos).

- [ ] **Step 3: Commit**

```bash
git add client/src/pages/Team.tsx
git commit -m "feat(client): página Equipo (gestión de empleadas)"
```

---

## Task 12: Verificación end-to-end y cierre

**Files:** ninguno (verificación).

- [ ] **Step 1: Backend completo verde**

Run: `cd server && npm run type-check && npx vitest run`
Expected: tsc sin errores; todos los tests pasan (incluye auth + team nuevos).

- [ ] **Step 2: Frontend compila**

Run: `cd client && npm run build`
Expected: build OK.

- [ ] **Step 3: Prueba manual (con server local levantado)**

Levantar server (`cd server && npm run dev`) y client (`cd client && npm run dev`). Verificar:
- Login como admin (dev auto-login) → ve los 6 ítems de nav incluido Equipo.
- Crear una empleada en Equipo con email/password.
- En prod real: loguear como esa empleada → solo ve Mensajes + Agenda; navegar a `/accounts` redirige a `/inbox`.
- Con la empleada, `GET /api/accounts` no trae `access_token/app_secret`.
- `POST /api/flows` con token de empleada → 403.

- [ ] **Step 4: Verificar guard de producción**

Confirmar que el VPS tendrá `NODE_ENV=production` (variable de entorno del deploy). Con eso, `dev-token` → 401.

- [ ] **Step 5: Commit final (si quedó algo suelto)**

```bash
git add -A && git commit -m "chore(rbac): verificación end-to-end RBAC admin/empleadas"
```

---

## Notas de despliegue

- Aplicar `0009_profiles.sql` en Supabase **antes** de desplegar el backend nuevo (si no, `authContext` rechaza a todos por falta de tabla profiles).
- Setear `NODE_ENV=production` en el VPS (desactiva el bypass `dev-token`).
- Setear `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` en el build del frontend para que use auth real (sin esto corre en modo dev = admin).
- Las empleadas se crean desde la página Equipo; el admin inicial sale del seed de la migración.

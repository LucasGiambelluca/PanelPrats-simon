# RBAC: admin y empleadas — diseño

Fecha: 2026-06-18
Estado: aprobado (pendiente review de spec)
Branch sugerido: `feat-rbac`

## Objetivo

Segmentar el panel en dos roles para un único estudio (Prats & Simon, varias
oficinas pero una sola organización):

- **admin**: acceso total (cuentas, flujos, configuración, agenda, mensajes, gestión de empleadas).
- **empleada**: solo conversaciones de los bots (ver + responder manualmente) y agenda (CRUD). Sin acceso a flujos, configuración ni gestión de cuentas.

El enforcement es **backend real + frontend** (Enfoque A): la API Express valida el rol en cada ruta protegida; el frontend además esconde nav y rutas.

## Contexto actual (estado del código)

- Auth: Supabase Auth (email/password) — `client/src/context/AuthContext.tsx`, `Login.tsx`, `ProtectedRoute.tsx`. Modo dev auto-login con usuario mock (id `03f6b5d7-febe-4af9-909b-70fba81e26af`) cuando no hay `VITE_SUPABASE_URL`.
- Datos: RLS por `accounts.user_id = auth.uid()` (migración 0001). Cada usuario ve solo lo suyo.
- API Express: usa `SUPABASE_SERVICE_KEY` (bypassa RLS) y **no chequea auth ni rol** en ninguna ruta.
- Frontend: el helper `client/src/lib/api.ts` (`api()`) centraliza TODAS las llamadas fetch — punto único para inyectar el header de autorización.
- Routers montados (`server/src/api/app.ts`): `/api/accounts`, `/api/flows`, `/api/conversations`, `/api/messages`, `/api/config`, `/api/appointments`, `/api/webhooks/meta`.

Implicancia: como toda la data de la app pasa por la API (service key), el enforcement vive en la API. RLS queda igual (defensa extra a futuro, fuera de v1).

## Matriz de permisos

| Recurso / ruta | admin | empleada |
|---|---|---|
| `GET /api/conversations` | ✅ | ✅ |
| `GET /api/conversations/:id/messages` | ✅ | ✅ |
| `POST /api/conversations/:id/handover` | ✅ | ✅ |
| `POST /api/messages/send` | ✅ | ✅ |
| `GET/POST/PUT/DELETE /api/appointments` | ✅ | ✅ |
| `GET /api/accounts` | ✅ (full) | ✅ (sin secretos) |
| `POST/PUT/DELETE /api/accounts`, `/connect`, `/disconnect` | ✅ | ❌ 403 |
| `* /api/flows` | ✅ | ❌ 403 |
| `* /api/config` | ✅ | ❌ 403 |
| `* /api/team` | ✅ | ❌ 403 |
| `GET /api/me` | ✅ | ✅ |
| `* /api/webhooks/meta` | público (firma HMAC) | público |

Regla de secretos: en `GET /api/accounts` con rol empleada, devolver solo `id, name, channel, status, phone_number` (y `external_id` para mostrar). **Nunca** `access_token`, `app_secret`, `verify_token`, `ai_api_key`, `ai_support_prompt`.

## Modelo de datos

Migración `supabase/migrations/0009_profiles.sql` (idempotente):

```sql
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'empleada' CHECK (role IN ('admin','empleada')),
  name text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Seed: el usuario existente queda como admin.
INSERT INTO profiles (id, role, name)
  SELECT id, 'admin', 'Administrador' FROM auth.users WHERE email = 'rsgroupenter@gmail.com'
  ON CONFLICT (id) DO UPDATE SET role = 'admin';
```

Single-org: sin columna `org_id`. Toda empleada pertenece implícitamente al único estudio; las líneas (accounts) del admin son las compartidas. Si en el futuro hace falta multi-estudio u oficinas, se agrega `org_id`/`office_id` y se ajusta el enforcement.

## Backend

### Middleware `authContext` — `server/src/api/middleware/auth.ts`
- Lee `Authorization: Bearer <jwt>`.
- Valida con `supabase.auth.getUser(jwt)` (el client de service key sirve para validar/decodificar el JWT del usuario).
- Carga `profiles` por `user.id`. Si no hay profile → tratar como sin permiso (401). Si `active = false` → 401.
- Adjunta `req.user = { id, role, name }`.
- Sin token o token inválido → **401**.
- **Modo dev**: si `jwt === 'dev-token'` y `process.env.NODE_ENV !== 'production'` → `req.user = { id: <mock>, role: 'admin' }`. En producción `dev-token` → 401 (sin excepción). Gate estricto: es el único bypass y no debe existir en prod.

### Guard `requireRole(role)` — mismo archivo
- Devuelve middleware que responde 403 si `req.user.role !== role`.

### Montaje (en `app.ts`)
- `authContext` se aplica a: `/api/accounts`, `/api/flows`, `/api/conversations`, `/api/messages`, `/api/config`, `/api/appointments`, `/api/team`, `/api/me`.
- **NO** se aplica a `/api/webhooks/meta` (Meta no manda JWT; se valida por firma HMAC). Se monta antes/aparte para no quedar bajo el middleware.
- `requireRole('admin')` se aplica a: router `/api/flows` completo, `/api/config` completo, `/api/team` completo, y a las rutas mutadoras de `/api/accounts` (POST `/`, PUT `/:id`, DELETE `/:id`, POST `/:id/connect`, POST `/:id/disconnect`). `GET /api/accounts` queda accesible a ambos roles, con filtrado de secretos por rol dentro del handler.

### Router nuevo `/api/team` — `server/src/api/routes/team.routes.ts` (admin only)
- `GET /` — lista empleadas (de `profiles` join opcional con email de `auth.users` vía Admin API).
- `POST /` — crea empleada: `supabase.auth.admin.createUser({ email, password, email_confirm: true })` + insert en `profiles` (role `empleada`, name). Devuelve la empleada creada.
- `PUT /:id` — actualizar `name` / `active`. **Desactivar (`active=false`) es la única forma de revocar acceso**: conserva el historial y bloquea el login (el middleware rechaza empleadas inactivas con 401). No hay borrado de empleadas.
- `POST /:id/reset-password` — set nueva password vía Admin API (opcional v1; si se omite, el admin recrea).

No se expone `DELETE` de empleadas: revocar = desactivar.

### Router nuevo `/api/me` — `server/src/api/routes/me.routes.ts`
- `GET /` — devuelve `{ id, role, name }` desde `req.user`.

### `GET /api/accounts` — filtrado por rol
- En `accounts.routes.ts`, el handler GET ya existente: si `req.user.role === 'empleada'`, mapear cada cuenta a la versión slim (sin secretos). Admin recibe el objeto completo como hoy.

## Frontend

### `lib/api.ts`
- Antes de cada fetch, obtener el token: `const { data } = await supabase.auth.getSession(); const token = data.session?.access_token`. En modo dev, `supabase.auth.getSession()` no aplica → usar `'dev-token'`.
- Agregar header `Authorization: Bearer <token>`.
- Manejar 401 (sesión vencida → redirigir a login) y 403 (mostrar toast "Sin permiso").

### `AuthContext`
- Tras tener sesión, llamar `GET /api/me` y exponer `role` y `name` en el contexto. Modo dev → `role: 'admin'`.
- Agregar `role` al `AuthContextType`.

### `Layout` (nav)
- `navItems` se filtra por rol. Empleada ve solo: **Mensajes** (`/inbox`) y **Agenda** (`/agenda`). Oculta: Mis Números, Bot Builder, Conexiones, Equipo.
- Admin ve todo + nuevo ítem **Equipo** (`/team`).
- El selector de cuenta activa queda visible para ambos (la empleada elige línea; es solo lectura del listado slim).

### `App` (routing)
- Nuevo componente `RoleRoute` (`components/RoleRoute.tsx`): si `role !== requiredRole`, redirige a `/inbox`.
- Envolver en `RoleRoute role="admin"`: `/accounts`, `/builder`, `/connections`, `/team`.
- `/inbox` y `/agenda` quedan accesibles a ambos roles (bajo `ProtectedRoute`).
- Índice: admin → `/accounts`; empleada → `/inbox`. Ajustar el `Navigate` index según rol.

### Página nueva `Equipo` — `client/src/pages/Team.tsx` (admin)
- Tabla de empleadas (nombre, email, estado activo).
- Form de alta (email + nombre + password inicial).
- Acciones: desactivar/activar (sin eliminar — revocar = desactivar).
- Usa un `teamApi` nuevo en `lib/api.ts`.

## Modo dev (seguridad)

- Frontend dev auto-login → admin (igual que hoy).
- Server: `dev-token` se acepta como admin **solo** si la variable `DEV_AUTH_BYPASS=1` está explícitamente seteada (opt-in). En producción no se setea ⇒ `dev-token` → 401. Es el único bypass y queda fuera de prod por diseño (no depende de que el deploy recuerde setear `NODE_ENV`, que el start script no hacía).

## Testing

Backend (vitest):
- `authContext`: token válido admin → `req.user.role='admin'`; token válido empleada → `role='empleada'`; sin token → 401; token inválido → 401; profile `active=false` → 401; `dev-token` con `NODE_ENV!=='production'` → admin; `dev-token` con `NODE_ENV='production'` → 401.
- `requireRole('admin')`: admin pasa; empleada → 403.
- `GET /api/accounts` empleada → respuesta sin `access_token/app_secret/verify_token/ai_api_key`.
- `/api/team` POST crea profile con role `empleada` (Admin API mockeada).

Frontend:
- `Layout` renderiza nav según rol (empleada: 2 ítems; admin: todos).
- `RoleRoute` redirige empleada fuera de rutas admin.

## Migración / despliegue

- Aplicar `0009_profiles.sql` en Supabase (SQL Editor) antes de desplegar el backend nuevo.
- Confirmar `NODE_ENV=production` en el VPS.
- El usuario existente queda admin por el seed; las empleadas se crean desde la página Equipo.

## Fuera de v1 (YAGNI)

- Auditoría: columnas `actor_id` en mensajes salientes manuales y en cambios de turnos (quién hizo qué).
- Filtrado de conversaciones/agenda por oficina (`office_id`).
- RLS por rol como defensa en profundidad (hoy el enforcement vive en la API).
- Multi-estudio (`org_id`).

## Archivos afectados

Nuevos:
- `supabase/migrations/0009_profiles.sql`
- `server/src/api/middleware/auth.ts`
- `server/src/api/routes/team.routes.ts`
- `server/src/api/routes/me.routes.ts`
- `client/src/pages/Team.tsx`
- `client/src/components/RoleRoute.tsx`
- Tests: `server/src/api/middleware/__tests__/auth.test.ts`, `server/src/api/routes/__tests__/team.routes.test.ts`

Modificados:
- `server/src/api/app.ts` (montaje de middleware + routers nuevos)
- `server/src/api/routes/accounts.routes.ts` (requireRole en mutaciones + filtrado de secretos en GET)
- `server/src/api/routes/flows.routes.ts`, `config.routes.ts` (requireRole admin a nivel router)
- `client/src/lib/api.ts` (Authorization header + teamApi + manejo 401/403)
- `client/src/context/AuthContext.tsx` (role + /api/me)
- `client/src/components/Layout.tsx` (nav por rol)
- `client/src/App.tsx` (RoleRoute + rutas)
- `client/src/types/index.ts` (tipo Profile/role)

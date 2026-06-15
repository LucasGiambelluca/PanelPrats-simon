# Guía de arranque — Panel WhatsApp Multi-Cuenta

Pasos para levantar el panel de cero en local. Tiempo estimado: ~20 min.

## 0. Requisitos

- **Node 20** (`node -v` → v20.x). En Node <22 ya está resuelto el tema de `ws` para Supabase Realtime.
- **Docker** (para Redis) — o un Redis instalado local.
- Cuenta en **Supabase** (gratis).
- Un **WhatsApp** de prueba (se vincula por QR, como WhatsApp Web).
- (Opcional) API key de **Groq** y/o **Gemini** si vas a usar nodos de IA.

> Windows + Git Bash: si `npm`/`npx` tiran `ERR_INVALID_ARG_TYPE`, usá PowerShell, o prefijá en bash con `ComSpec="C:\Windows\System32\cmd.exe" npm ...`.

---

## 1. Supabase

1. Crear proyecto nuevo en https://supabase.com → anotá la **Project URL**.
2. **Project Settings → API**: copiá
   - `anon` key (para el frontend)
   - `service_role` key (para el backend) — es una JWT larga. **NO** uses la "DB secret" (`sb_secret_...`).
3. **SQL Editor → New query**: pegá y ejecutá **todo** el contenido de
   `supabase/migrations/0001_init_multicuenta.sql`.
   Crea 9 tablas (`accounts`, `flows`, `flow_executions`, `flow_executions_history`,
   `whatsapp_conversations`, `whatsapp_messages`, `flow_logs`, `audit_logs`, `reports`),
   índices y políticas RLS.
4. **Realtime**: Database → Replication → habilitar Realtime para
   `whatsapp_messages` y `whatsapp_conversations` (el inbox lo usa).
5. **Auth → Users → Add user**: creá un usuario (email + password) para loguearte al panel.

---

## 2. Redis

Con Docker (recomendado), desde la raíz del repo:
```
docker compose up -d
```
Levanta Redis en `localhost:6379`. Apagar: `docker compose down`.

Sin Docker: instalá Redis y dejalo escuchando en `127.0.0.1:6379`.

---

## 3. Backend (`server/`)

1. Completá `server/.env` (ya existe con placeholders):
   ```
   SUPABASE_URL=https://TUPROYECTO.supabase.co
   SUPABASE_SERVICE_KEY=eyJ...service_role...
   REDIS_URL=redis://127.0.0.1:6379
   AUTH_BASE_PATH=./auth
   GROQ_API_KEY=        # opcional
   GEMINI_API_KEY=      # opcional
   PORT=3001
   CORS_ORIGIN=http://localhost:5173
   ```
2. Instalar y correr:
   ```
   cd server
   npm install
   npm run dev
   ```
   Deberías ver `🚀 server en :3001`. Probá `http://localhost:3001/health` → `{"ok":true}`.

> Las credenciales de WhatsApp se guardan en `server/auth/{account_id}/` (gitignored).

---

## 4. Frontend (`client/`)

1. Completá `client/.env`:
   ```
   VITE_SUPABASE_URL=https://TUPROYECTO.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ...anon...
   VITE_API_URL=http://localhost:3001
   ```
   > Si dejás `VITE_SUPABASE_URL` vacío, el front entra en **DEV MODE** (login mock, sin Supabase). Para uso real, completá las 3.
2. Instalar y correr:
   ```
   cd client
   npm install
   npm run dev
   ```
   Abre en `http://localhost:5173`.

---

## 5. Smoke E2E (camino feliz)

1. **Login** con el usuario que creaste en Supabase Auth.
2. **Cuentas** → "Agregar" → nombre (ej. "Soporte"). Aparece en la lista.
3. **Conectar** → escaneá el QR desde WhatsApp del teléfono
   (WhatsApp → Dispositivos vinculados → Vincular dispositivo).
   El estado pasa a `connected`.
4. **Bot Builder** → con la cuenta seleccionada arriba, armá un flujo mínimo:
   - nodo `Inicio` → `Mensaje` ("¡Hola! ¿En qué te ayudo?")
   - poné `trigger_word` = `hola`, **Guardar**, marcá **activo**.
5. Desde **otro** WhatsApp, mandá `hola` al número vinculado → debería responder.
6. **Inbox** → ves la conversación y los mensajes en tiempo real.
   "Tomar conversación" (handover) → el bot calla y podés responder manual.

---

## 6. Problemas comunes

| Síntoma | Causa / fix |
|---------|-------------|
| `supabaseUrl is required` / RLS falla | `SUPABASE_SERVICE_KEY` vacía o es la `sb_secret_` en vez de la JWT `service_role`. |
| Inbox no actualiza solo | Realtime no habilitado en las tablas (paso 1.4). |
| QR no aparece | Backend no llega a Supabase (revisá `accounts.status`), o la cuenta ya estaba `connected`. |
| El bot no responde | Flujo sin `is_active`, sin `trigger_word` que matchee, o cuenta no `connected`. |
| `ERR_INVALID_ARG_TYPE` en npm | Windows/Git Bash: usá PowerShell o el prefijo `ComSpec=...`. |
| CORS bloqueado | `CORS_ORIGIN` del server debe incluir el origen del front (`http://localhost:5173`). |

---

## 7. Tests

- Backend: `cd server && npm run test:run` (28 tests).
- Frontend: `cd client && npm run build` (type-check + build).

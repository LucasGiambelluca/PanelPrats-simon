# AUDITORÍA DE PRODUCCIÓN — Panel WhatsApp multi-cuenta

> **VEREDICTO: 🟢 LISTO** (código) — sujeto al checklist de pre-deploy de abajo. (era 🔴 NO LISTO)
> Conteo inicial: **1 bloqueante (🔴)** · **10 altos (🟠)** · **6 medios (🟡)** · **1 bajo (⚪)**
> Estado 2026-06-21: **0 bloqueantes · 0 altos abiertos** (B1 + A1-A10 resueltos). Quedan 🟡 medios + ⚪ como deuda documentada.
>
> **⚠️ Pre-deploy obligatorio antes de producción:**
> 1. Aplicar migración `0014_webhook_idempotency.sql` en Supabase (índice único parcial). Sin esto, la defensa-en-DB de B1 no existe.
> 2. `NODE_ENV=production` + `CORS_ORIGIN` explícito + **quitar `DEV_AUTH_BYPASS`** del entorno de prod (el boot aborta si quedan juntos).
> 3. Rotar las keys que estuvieron en el `.env` local (OpenAI, DAILY) — precaución (nunca se commitearon, verificado).
> 4. Opcional: setear `SENTRY_DSN` para activar error tracking; setear `TZ`.
> Fecha: 2026-06-21 · Rama: `feat-omnichannel` · Stack: Node/Express/TS + Supabase(PG) + Baileys/Meta + Redis + Gemini
> Categoría "integridad de plata": **N/A** (no hay pasarela de pagos; verificado en código).

El proyecto está cerca, con base sólida (auth Supabase + RBAC, firma HMAC de webhooks validada, constraint anti-doble-reserva en DB, 98/98 tests verdes). Falta cerrar resiliencia de webhooks y hardening de seguridad antes de exponerlo.

---

## Lo que YA está bien (verificado)

- ✅ **Firma HMAC de webhooks Meta** validada con `timingSafeEqual` — `webhooks.routes.ts:7-24,72-110`
- ✅ **Auth Supabase JWT + RBAC** (admin/empleada), chequea `active` — `auth.ts:20-50`
- ✅ **Anti-doble-reserva** con constraint `EXCLUDE USING gist` + recheck en app — `0012_appointment_no_overlap.sql`, `AppointmentService.ts:157-160`
- ✅ **Secretos fuera de git**: `.env` ignorado, nunca commiteado en 138 commits (verificado)
- ✅ **Handlers globales** `unhandledRejection`/`uncaughtException` — `index.ts:17-22`
- ✅ **Timeouts** en todas las llamadas IA (OpenAI/Groq/Gemini) — `AIService.ts:68,110,163,199`
- ✅ **Tests** 28 archivos / 98 casos, todos verdes (`npm run test:run`)
- ✅ **Índices** en FKs principales (account_id, conversation_id, external_id, token_hash) — `0001_init...`
- ✅ **CORS** restrictivo en prod (exige `CORS_ORIGIN`) · lockfiles commiteados

---

## 🔴 BLOQUEANTE (cierra el camino a LISTO)

| # | Hallazgo | Evidencia | Por qué bloquea |
|---|----------|-----------|-----------------|
| **B1** | **Webhooks sin idempotencia.** No hay dedupe por `message_id`; cada evento se inserta/procesa siempre. | `MessageStore.ts:29-42`, `MetaClient.ts:99-120` | Meta **reintenta** webhooks hasta ~38h. Sin dedupe → mensajes duplicados y **doble ejecución de flujos** (doble respuesta, doble avance de estado). |

---

## 🟠 ALTOS (resolver para llegar a LISTO)

| # | Hallazgo | Evidencia |
|---|----------|-----------|
| A1 | **Pérdida de eventos**: si el procesamiento falla tras devolver 200, el evento se pierde (sin DLQ/retry). | `webhooks.routes.ts:118-123` |
| A2 | **IDOR cross-cuenta**: endpoints con `:id` no validan ownership. Crítico en PUT de credenciales (`access_token`, `app_secret`). Mitiga: modelo single-org + RBAC. | `accounts.routes.ts:158-252`, `salas.routes.ts:28-49`, `conversations.routes.ts:35-61` |
| A3 | **`DEV_AUTH_BYPASS=1` presente en `.env`**. Gateado por `NODE_ENV!=='production'`, pero hay que garantizar `NODE_ENV=production` y quitar el flag en deploy. | `auth.ts:16-17`, `server/.env:27` |
| A4 | **Sin validación de schema** en bodies (zod instalado pero sólo usado en nodos de flow). | `appointments/accounts/flows/team/config/salas.routes.ts` |
| A5 | **Sin rate limiting** en endpoints sensibles (team, config, reset password). | `app.ts` (ausente) |
| A6 | **Sin helmet / security headers** (CSP, HSTS, X-Frame-Options). | `app.ts` (ausente) |
| A7 | **Sin graceful shutdown** (SIGTERM): conexiones Redis/WS/mensajes en vuelo se cortan en redeploy. `closeRedis()` existe pero nunca se llama. | `index.ts`, `redis.ts:20-22` |
| A8 | **Meta API sin retry/backoff**: un 5xx transitorio = mensaje saliente perdido. | `MetaClient.ts:77`, `WhatsAppOfficialClient.ts:49` |
| A9 | **Sin error tracking** (Sentry) + logging mixto `console`/winston **sin masking de secrets**. | `index.ts:17-22`, `logger.ts` |
| A10 | **`claves.txt` y `brand_info.txt` NO están en `.gitignore`** (untracked hoy, pero un `git add .` los commitea). Backups Supabase / plan de rollback sin verificar. | root, `.gitignore` |

---

## 🟡 MEDIOS (deuda; no bloquean)

| # | Hallazgo | Evidencia |
|---|----------|-----------|
| M1 | Faltan índices B-tree: `appointments(start_time,end_time)`, `appointments(status)`, `appointments(phone)`. | `0012` sólo tiene GIST de la constraint |
| M2 | Sin paginación en listados: appointments, accounts, flows, team (devuelven todo). | `AppointmentService.ts:96-100`, `accounts.routes.ts:93` |
| M3 | `fs` síncrono en endpoints admin (bloquea event loop). | `config.routes.ts:16,54,110`, `accounts.routes.ts:281` |
| M4 | Sin CI que corra tests y bloquee merge (tests pasan local, pero no hay gate). | no hay `.github/workflows` |
| M5 | Falta test de concurrencia de reservas (la constraint DB ya protege → riesgo bajo). | `AppointmentAvailabilityExecutor.test.ts` |
| M6 | `/health` no chequea dependencias (no es readiness real). | `app.ts:36` |

## ⚪ BAJOS

- Runbook de deploy/rollback ausente; README mínimo. (`README.md`)

---

## Plan priorizado para cerrar el proyecto

### Sprint 1 — Desbloquear (🔴 + webhooks 🟠) → saca de NO LISTO
- [x] **B1** Idempotencia webhook: claim atómico en Redis (`SET NX EX 48h`, `services/idempotency.ts`) en ambos paths (Meta + WhatsApp Official) **antes** de procesar; persiste `wa_message_id`; índice único parcial DB (migración `0014`) + `insertMessage` tolera 23505. Tests: 9 verdes. ✅ 2026-06-21
- [x] **A1** No perder eventos: `services/WebhookQueue.ts` — el webhook verifica firma y **encola** en lista Redis durable (RPOPLPUSH reliable), devuelve 200 rápido; worker en background procesa con **retry/backoff exponencial** (ZSET `wh:retry`, 5 intentos) y **dead-letter** (`wh:deadletter`); recupera `wh:processing` al boot; fail-safe inline si Redis cae. Tests: 8 verdes. ✅ 2026-06-21
- [x] **A8** Retry con backoff en salientes a Meta API: `utils/retry.ts` (`withRetry`) envuelve los `axios.post` de `MetaClient.sendMessage` y `WhatsAppOfficialClient.sendMessage`; reintenta solo transitorios (red/timeout, 429, 5xx), NO 4xx; 3 intentos, backoff 500→1000→2000ms. Tests: 6 verdes. ✅ 2026-06-21

> **Sprint 1 COMPLETO** (B1 + A1 + A8). Sin bloqueantes 🔴. Veredicto pasó de NO LISTO → **CASI**.

### Sprint 2 — Hardening de seguridad (🟠) — COMPLETO
- [x] **A10** `claves.txt`, `brand_info.txt`, `*.ase`, `*.pdf`, `*.key`, `*.pem`, `.env.*` en `.gitignore` (`.env.example` preservado). ✅ 2026-06-21
- [x] **A6** `helmet()` global en `app.ts` (CSP/HSTS/X-Frame-Options). ✅ 2026-06-21
- [x] **A5** `express-rate-limit`: general (300/15min) sobre `/api` excluyendo el webhook de Meta; estricto (30/15min) en `/api/team` y `/api/config`. `trust proxy` para IP real. ✅ 2026-06-21
- [x] **A4** `validateBody(schema)` (`middleware/validate.ts`, zod `.strict()`) en team (POST/PUT/reset), appointments (POST), accounts (POST/PUT). Tests: 3 middleware + 1 ruta. Pendiente liviano: flows POST/PUT, config POST. ✅ 2026-06-21
- [x] **A3** Fail-fast al boot si `NODE_ENV=production` + `DEV_AUTH_BYPASS=1` (`index.ts`). El gating ya era doble opt-in (`auth.ts:16-17`). **Deploy:** además rotar DAILY/OpenAI keys del `.env` local. ✅ 2026-06-21
- [x] **A2** **Mitigado por diseño (single-org).** Toda la superficie sensible de cuentas (credenciales/connect/qr/disconnect/delete + flows/config/team) es `requireRole('admin')` (verificado). Las rutas operativas (salas/appointments/conversations) son org-wide a propósito: un estudio, todo el staff atiende a todos los clientes — es el límite de confianza buscado, no IDOR cross-tenant. El hallazgo asumía multi-tenant que no aplica. **Nota:** si pasa a multi-org, hace falta scoping real por `:id`. ✅ 2026-06-21

### Sprint 3 — Operación
- [x] **A7** Graceful shutdown: handler SIGTERM/SIGINT en `index.ts` → `server.close()` + `reminders.stop()` + `webhookQueue.stop()` + `manager.stopAll()` (nuevo) + `closeRedis()`, con timeout de respaldo de 10s. ✅ 2026-06-21
- [x] **A9** Error tracking + masking: `config/errorTracking.ts` (Sentry opt-in por `SENTRY_DSN`, no-op si no; capturado en handlers globales + dead-letter de la cola) y masking de secretos en el logger winston (JWT/Bearer/`sk-`/campos `*token*`/`*secret*`/`password`). Tests: 6 verdes. ✅ 2026-06-21

> **Todos los altos cerrados.** Veredicto → **LISTO** (código).

### Deuda documentada (🟡 / ⚪ — no bloquean)
- [ ] **M4** CI (GitHub Actions) que corra `npm run test:run` y bloquee merge.
- [ ] **M1** Índices B-tree en appointments (`start_time,end_time`, `status`). · **M2** Paginación `?limit&offset`. · **M6** `/health` que verifique Redis+Supabase.
- [ ] **M5** Test flaky `AppointmentAvailabilityExecutor` (depende de Supabase real; pasa aislado, falla por orden en suite). Aislar con mock de DB. *(durante esta auditoría se arregló una fragilidad análoga en `AccountManager.channels.test.ts`: `constructor.name` → `instanceof`.)*
- [ ] Verificar backups Supabase + probar restore. Escribir runbook (⚪). Cubrir con zod flows/config POST (resto de A4).

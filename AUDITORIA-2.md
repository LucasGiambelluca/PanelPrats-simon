# AUDITORÍA #2 — Re-pase del gate + review adversarial del hardening

> **VEREDICTO: 🟢 LISTO** (código) — sujeto al checklist de pre-deploy.
> Fecha: 2026-06-21 · Rama: `feat-omnichannel` · sobre el commit `401ac8b` + fixes de este pase.
> Segunda corrida del gate: re-verifica que los fixes de la auditoría #1 sostienen, revisa **adversarialmente el código nuevo** (idempotencia/cola/retry/validación/shutdown) y barre la deuda 🟡. Tests: **130/130 verdes**, `tsc` 0.

---

## 1. Lo que sostiene (re-verificado en código)

- ✅ Firma HMAC verificada **antes** de encolar (`webhooks.routes.ts`).
- ✅ helmet + rate-limit (webhook y salas-público excluidos del limiter).
- ✅ Todas las rutas de credenciales/admin con `requireRole('admin')`.
- ✅ Doble gate de `DEV_AUTH_BYPASS` + fail-fast al boot.
- ✅ Masking de secretos cubre los logs de la cola y del resto.
- ✅ CORS restrictivo en prod.
- ✅ Idempotencia (B1) y cola durable (A1) presentes y testeadas.

---

## 2. Hallazgos NUEVOS — y qué se hizo

### Corregidos en este pase
| # | Sev | Hallazgo | Fix |
|---|-----|----------|-----|
| N1 | 🟠 | **Runner de migraciones solo aplicaba `0001`** (`config.routes.ts:9` hardcodeado). `/sync-db` NO aplicaba 0002–0014 → la defensa-DB de B1 (0014) nunca se instalaba por esa vía. | Ahora lee el directorio y aplica **todas las `*.sql` en orden** (idempotentes); responde `applied[]` y `failedMigration`. |
| N2 | 🟠 | **Handlers SIGTERM/SIGINT registrados DESPUÉS de `bootstrapExisting()`** (`index.ts`). Una señal durante la reconexión (varios seg) se perdía → apagado sucio en k8s/Docker. | Registro movido **antes** del `await bootstrapExisting()`. |
| N3 | 🟡 | **`MessageStore` tragaba cualquier 23505** — si en el futuro se agrega otra constraint única, una violación legítima se perdería en silencio. | Acotado a `uq_wamsg_wa_message_id` / mensaje con `wa_message_id`; el resto se relanza. |
| N4 | 🟡 | **Backoff de la cola sin tope** — una mala config (MAX alto) daría demoras enormes. | `Math.min(..., 60_000)` (cap 1 min). |
| N5 | 🟡 | **`appointments PUT` sin validación** (pasaba `req.body` crudo a `update`). | `validateBody(updateAppointmentSchema)`. |

### Reales, quedan como deuda (no bloquean)
| # | Sev | Hallazgo | Evidencia |
|---|-----|----------|-----------|
| N6 | 🟡 | Rutas mutantes aún sin `validateBody`: flows POST/PUT, config POST, salas POST/invitar/host-token/join, conversations handover, calls/voice. `messages/send` tiene validación manual adecuada. | resto de A4 |
| N7 | 🟡 | Dead-letter guarda el `entry` crudo (puede traer contenido de mensajes/PII) en Redis sin TTL. Riesgo operativo, no técnico. | `WebhookQueue` DLQ |
| N8 | 🟡 | Ventana de crash micro entre `ZREM` y `LPUSH` en `promoteDueRetries` (1 worker, sin concurrencia real; solo si el proceso muere en ese instante). | `WebhookQueue.promoteDueRetries` |
| N9 | 🟡 | `recoverProcessing` corre una vez al boot; si Redis está caído en ese momento, los jobs colgados no se rescatan hasta el próximo reinicio. | `WebhookQueue.start` |
| — | 🟡 | Persisten de #1: índices B-tree appointments, paginación, `fs` sync en endpoints admin, `/health` sin chequear deps, CI ausente, test flaky `AppointmentAvailabilityExecutor`. | — |

### Descartados (falsos positivos del review automático)
- ❌ *"Race async en `WebhookQueue.process` (handler settlea después del catch)"* — **falso**: el `await` serializa; el catch solo corre tras rechazarse la promesa. No hay ejecución paralela.
- ❌ *"helmet antes de `express.json` rechaza bodies del webhook"* — **falso**: helmet setea cabeceras de **respuesta**, no parsea ni rechaza el body del request.
- ⚠️ *"Rate limiter por orden, no por regla"* — válido pero menor; el webhook se excluye por estar montado antes. Mejora opcional: `skip` explícito.

---

## 3. Pre-deploy (sin cambios respecto de #1, con una aclaración)

1. **Aplicar migraciones en Supabase.** Ahora `/sync-db` corre TODAS en orden (incluida `0014`). Igual conviene verificar en el SQL editor que `uq_wamsg_wa_message_id` quedó creado.
2. `NODE_ENV=production` + `CORS_ORIGIN` + quitar `DEV_AUTH_BYPASS` (el boot aborta si conviven).
3. Rotar keys OpenAI/DAILY del `.env` local (precaución; nunca commiteadas).
4. Opcional: `SENTRY_DSN`, `TZ`.

> **Veredicto: LISTO (código).** Los hallazgos nuevos accionables se cerraron (N1–N5). El resto es deuda 🟡 documentada que no bloquea producción para un estudio single-org de bajo volumen.

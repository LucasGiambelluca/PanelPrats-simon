# DEPLOY — Panel WhatsApp (EasyPanel + Docker + Traefik)

Runbook de despliegue del panel en el VPS del estudio (EasyPanel + Docker Swarm + Traefik).
Stack: Node/Express/TS (API) + cliente Vite servido por el mismo server + Supabase (DB cloud) + Redis.

> ⚠️ El VPS corre **producción viva** del estudio (n8n, Chatwoot, Evolution API). El panel
> se despliega como una **app nueva de EasyPanel**, aislada. NO usar `docker compose`/`docker stack`
> a mano: riesgo de tumbar los servicios del estudio.

---

## Arquitectura

```
┌─ App "panel" (1 contenedor Node)
│   Dockerfile multi-stage: build cliente (Vite) + server (tsc) -> runtime slim
│   API Express + SPA (mismo origen), puerto 3001
│   dominio pys-panel.ynewvd.easypanel.host -> Traefik + TLS Let's Encrypt
│   volumen /data -> sesiones baileys persistentes (/data/auth)
│
├─ Redis "panel-redis" (1-click EasyPanel) — cola de webhooks + idempotencia
│
└─ DB: Supabase cloud (externa, migraciones 0001-0021 ya aplicadas)
```

---

## Pre-requisitos (ya hechos)

- [x] Código en GitHub: `LucasGiambelluca/PanelPrats-simon`, branch `feat-omnichannel`.
- [x] VPS con 2 GiB swap + `vm.swappiness=10` (protege el build de OOM).
- [x] Migraciones 0001-0021 aplicadas en Supabase (verificar: `node server/scripts/db-audit.js`).
- [x] `.env`, `vps.md`, `claves.txt` fuera de git (`.gitignore`).

---

## Paso a paso (EasyPanel UI)

### 1. Conectar GitHub (una vez)
Settings → Git/GitHub → conectar cuenta o agregar deploy key del repo (si es privado).

### 2. Servicio Redis
Proyecto `pys` → **+ Service → Redis** → nombre `panel-redis`.
Hostname interno resultante: `pys_panel-redis`.

### 3. App
Proyecto `pys` → **+ Service → App** → nombre `panel`.
- **Source:** GitHub → repo `PanelPrats-simon`, branch `feat-omnichannel`.
- **Build:** método **Dockerfile** (path `Dockerfile` en la raíz).
- **Build Args:**
  ```
  VITE_SUPABASE_URL=https://ronepzzmhqsyvhxudhqo.supabase.co
  VITE_SUPABASE_ANON_KEY=<anon key — Supabase → Settings → API>
  VITE_API_URL=https://pys-panel.ynewvd.easypanel.host
  ```
  > Las `VITE_*` se hornean en build-time. Si faltan, el front entra en DEV MODE (login mock).
  > Usar la **anon** key (sujeta a RLS), NUNCA la service key en el cliente.

### 4. Environment (runtime)
```
NODE_ENV=production
PORT=3001
CORS_ORIGIN=https://pys-panel.ynewvd.easypanel.host
PUBLIC_APP_URL=https://pys-panel.ynewvd.easypanel.host
SUPABASE_URL=https://ronepzzmhqsyvhxudhqo.supabase.co
SUPABASE_SERVICE_KEY=<service key — la misma de server/.env>
REDIS_URL=redis://pys_panel-redis:6379
AUTH_BASE_PATH=/data/auth
TZ=America/Argentina/Buenos_Aires
```
- **NO** setear `DEV_AUTH_BYPASS` (el boot aborta con `NODE_ENV=production`).
- Opcional: `SENTRY_DSN` (error tracking), `GEMINI_API_KEY`/`GROQ_API_KEY`.
- La key de OpenAI del agente va **por cuenta en la DB** (`accounts.ai_api_key`), no por env.

### 5. Volumen (sesión WhatsApp persistente)
Mounts → Volume: `panel-data` → mount path `/data`.
Sin esto, cada redeploy obliga a re-escanear el QR de baileys.

### 6. Dominio
Domains → Add → `pys-panel.ynewvd.easypanel.host` → port `3001` → **HTTPS on**.
Traefik emite cert Let's Encrypt automático.

### 7. Deploy
Botón **Deploy**. EasyPanel clona, buildea el Dockerfile en el VPS y levanta. Seguir logs.

---

## Verificación post-deploy

```bash
curl https://pys-panel.ynewvd.easypanel.host/health        # -> {"ok":true}
```
- [ ] Panel carga en el dominio.
- [ ] Login **real** (no mock) → confirma `VITE_*` bien horneadas.
- [ ] Conectar baileys al **número nuevo** (no el de Evolution) → QR → conectado.
- [ ] Smoke end-to-end: WhatsApp real → agente IA responde → agenda una cita.

### Webhook de Meta (cuentas con canal oficial)
Meta App → WhatsApp → Configuration:
- Callback URL: `https://pys-panel.ynewvd.easypanel.host/api/webhooks/meta`
- Verify token: el valor de `accounts.verify_token` de **esa** cuenta (está en la DB, no es env).

---

## Configuración de la cuenta (para que el agente sirva)

- `agent_mode = 'ai_first'` en la cuenta (hoy `flows`).
- Cargar `business_context` (vacío hoy) — info del estudio para que el agente responda.
- Canal por cuenta: baileys (no oficial) o Meta Cloud API (oficial). Evitar colisión de número
  con Evolution API (un número = una sola sesión activa).

---

## Rollback

- **Vía EasyPanel:** App `panel` → Deployments → seleccionar deploy previo → **Redeploy**.
- **Vía git:** `git revert <sha> && git push` → auto-deploy del commit corregido.
- **Apagado limpio:** el server maneja SIGTERM (cierra WS/Redis/requests en vuelo, timeout 10s),
  así que un redeploy no corta mensajes en proceso de forma abrupta.

## Troubleshooting

| Síntoma | Causa probable | Fix |
|---|---|---|
| Front muestra login mock | `VITE_SUPABASE_URL` faltó en build args | re-build con los 3 build args |
| `/health` 502 | contenedor no levantó | ver logs; chequear `SUPABASE_*` y `REDIS_URL` |
| QR cada redeploy | volumen `/data` no montado | montar volumen `panel-data` → `/data` |
| Webhook Meta 403 en verify | `verify_token` no coincide | igualar al de `accounts.verify_token` |
| WhatsApp se desconecta solo | colisión de número con Evolution | usar número distinto o migrar el canal |
| OOM / box lenta | build pesado sin swap | swap ya en 2G; no buildear en hora pico |

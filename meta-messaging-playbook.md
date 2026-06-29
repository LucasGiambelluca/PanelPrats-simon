# Playbook: Integración de mensajería Meta (Facebook + Instagram)

> Documento de instrucciones para Claude Code. Define cómo tratar los mensajes
> de Facebook Messenger e Instagram dentro de la plataforma omnicanal de RS GROUP,
> qué hay que configurar en Meta, y cómo aplicarlo en el stack Node.js / Express /
> PostgreSQL. Seguir este documento al pie. Ante ambigüedad, preguntar antes de
> improvisar la arquitectura.

---

## 0. Principio rector

El canal (Messenger, Instagram, WhatsApp) es **solo el transporte**. La unidad de
negocio es la **conversación**, agnóstica del canal. Todo mensaje entrante —venga
de donde venga— se normaliza a una estructura interna común y se persiste contra
una `conversation` ligada a un `inbox`. El agente nunca toca tokens ni credenciales
de Meta directamente; responde sobre la conversación y la plataforma se encarga de
enrutar el envío por la API correspondiente.

Regla mental: **webhook entra → valido firma → normalizo → persisto idempotente →
notifico → respondo vía Send API**.

---

## 1. Requisitos de configuración en Meta

### 1.1 Cuentas y activos previos

- Una **App de Meta** (Meta Developer Portal) en modo Business.
- Una **Página de Facebook** (para Messenger).
- Una **cuenta de Instagram Professional** (Business o Creator). Las cuentas
  personales no sirven y deben convertirse antes.
- Un **System User** con rol Admin en el Business Manager, para generar tokens de
  larga duración en producción (no usar tokens de usuario personal en prod).

### 1.2 Método de autenticación de Instagram — decisión importante

Hay dos caminos. **Elegir Instagram Business Login** para los inbox nuevos:

| Método | Cuándo usarlo |
|---|---|
| **Instagram Business Login** (preferido) | Camino actual. IG pega directo contra la API de mensajería de Instagram. Configuración más simple, menos permisos de página. |
| **Facebook Login for Business** (legacy) | Solo si necesitás funcionalidad extra de página o ya tenés todo armado sobre FB Login. En deprecación: los IG vía Facebook Login dejan de soportarse a futuro. No construir nuevo sobre esto. |

Para Messenger (Facebook) seguís usando **Facebook Login for Business** con permisos
de página. Son dos flujos OAuth distintos aunque convivan en la misma App.

### 1.3 Permisos (App Review)

Pedir en *App Review → Permissions and Features* y obtener **Advanced Access**:

**Instagram (Business Login):**
- `instagram_business_basic`
- `instagram_business_manage_messages`

**Facebook Messenger:**
- `pages_messaging`
- `pages_manage_metadata`
- `pages_show_list`
- `pages_read_engagement`

> Nota: hasta tener App Review aprobada se puede testear con hasta ~25 usuarios de
> prueba (Instagram Testers / roles de la app) **sin** review. Para mensajear
> usuarios reales a escala, `instagram_business_manage_messages` tiene que estar
> aprobado.

### 1.4 Webhooks

En *App Dashboard → Webhooks*:

- Suscribir el objeto **Instagram** y el objeto **Page** (Messenger).
- Campo a suscribir: **`messages`** (y opcionalmente `messaging_postbacks`,
  `message_reactions`, `messaging_seen` según features que vayas a usar).
- **Callback URL:** apuntar al endpoint de la plataforma, p. ej.
  `https://api.rsgroup.tld/webhooks/meta/instagram` y
  `https://api.rsgroup.tld/webhooks/meta/messenger`.
- **Verify Token:** un secreto random guardado en env (`META_VERIFY_TOKEN`). Meta
  lo manda en el handshake GET y hay que devolver el `hub.challenge`.

### 1.5 Handover Protocol (Messenger) — no saltear

Meta solo deja **una app como receptor primario** de los mensajes de una página a
la vez. Si hay otra app conectada a la misma página, los mensajes pueden no llegar
o llegar como *standby messages*.

Acción de config: en la Página → *Settings → Advanced Messaging → Handover Protocol*,
poner nuestra app como **Primary Receiver**. Si conviven varias herramientas sobre
la misma página, hay que implementar *thread control* (pedir/ceder control del hilo)
o consumir *standby* explícitamente. Documentar esta decisión por página.

### 1.6 Política de ventana de mensajería — restricción dura

Esto condiciona la lógica de envío, no es opcional:

- Solo se puede mensajear a usuarios que **ya nos escribieron**.
- Al recibir un mensaje del usuario se abre una **ventana de 24 hs** para
  respuestas libres (free-form).
- Pasadas las 24 hs, solo se permiten **Human Agent** messages por hasta **7 días**,
  y solo para soporte. No hay outreach no solicitado por la API oficial.
- **Identificadores:** el usuario de Instagram se identifica por **IGSID**
  (Instagram Scoped User ID), único por cada cuenta business con la que conversa.
  En Messenger es el **PSID** (Page Scoped User ID). Persistir el scoped ID como
  identidad de contacto **por inbox**, nunca como identidad global.

### 1.7 Rate limits

La Graph API es estricta (orden de ~200 llamadas/hora por cuenta según endpoint).
Diseñar con esto en mente: cachear perfiles, pedir solo los campos necesarios,
batchear cuando se pueda. No hacer polling: **los eventos llegan por webhook**.

---

## 2. Variables de entorno

```
META_APP_ID=
META_APP_SECRET=                # para validar firma X-Hub-Signature-256
META_VERIFY_TOKEN=              # handshake de webhook (GET)
META_GRAPH_VERSION=v21.0        # fijar versión explícita, no usar "latest"
# Tokens de página / IG se guardan por-inbox en DB, cifrados, NO en env.
```

Los **page access token** (Messenger) y los tokens de la cuenta IG se guardan
**por inbox en la base, cifrados en reposo** (no en `.env`, porque son por-cuenta y
rotables). Renovar/refrescar antes de expirar.

---

## 3. Modelo de datos (PostgreSQL)

Mínimo viable, agnóstico de canal:

```sql
-- Canal conectado (una página de FB o una cuenta IG)
CREATE TABLE inboxes (
  id              BIGSERIAL PRIMARY KEY,
  channel         TEXT NOT NULL CHECK (channel IN ('messenger','instagram','whatsapp')),
  external_id     TEXT NOT NULL,            -- page_id (FB) o ig_account_id (IG)
  access_token    BYTEA NOT NULL,           -- cifrado en reposo
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (channel, external_id)
);

-- Persona del otro lado (scoped al inbox)
CREATE TABLE contacts (
  id              BIGSERIAL PRIMARY KEY,
  inbox_id        BIGINT NOT NULL REFERENCES inboxes(id),
  scoped_user_id  TEXT NOT NULL,            -- IGSID / PSID
  display_name    TEXT,
  profile         JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (inbox_id, scoped_user_id)         -- identidad por-inbox, nunca global
);

CREATE TABLE conversations (
  id              BIGSERIAL PRIMARY KEY,
  inbox_id        BIGINT NOT NULL REFERENCES inboxes(id),
  contact_id      BIGINT NOT NULL REFERENCES contacts(id),
  status          TEXT NOT NULL DEFAULT 'open',
  window_expires_at TIMESTAMPTZ,            -- ventana de 24hs; se refresca al entrar msg del usuario
  last_message_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (inbox_id, contact_id)
);

CREATE TABLE messages (
  id              BIGSERIAL PRIMARY KEY,
  conversation_id BIGINT NOT NULL REFERENCES conversations(id),
  external_mid    TEXT,                     -- message id de Meta -> idempotencia
  direction       TEXT NOT NULL CHECK (direction IN ('inbound','outbound')),
  content_type    TEXT NOT NULL DEFAULT 'text',
  body            TEXT,
  media_url       TEXT,                     -- guardar SOLO el CDN URL privacy-aware de Meta
  raw             JSONB,                    -- payload original para auditoría
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (external_mid)                     -- clave de dedupe
);
```

Notas:
- `external_mid` con índice único es la **clave de idempotencia** del webhook.
- `media_url`: guardar **solo el CDN URL privacy-aware** que da Meta para renderizar;
  no descargar/rehostear sin necesidad.
- `window_expires_at` materializa la ventana de 24 hs para decidir qué tipo de envío
  está permitido sin tener que recalcular en cada request.

---

## 4. Webhook receiver (Express)

### 4.1 Verificación (GET) — handshake de Meta

```js
// GET /webhooks/meta/:channel
router.get('/webhooks/meta/:channel', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode === 'subscribe' && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge); // devolver el challenge tal cual
  }
  return res.sendStatus(403);
});
```

### 4.2 Validación de firma (HMAC) — obligatorio antes de procesar

Meta firma el body con `X-Hub-Signature-256` usando el App Secret. **Hay que validar
contra el raw body** (no el JSON ya parseado). Configurar el body parser para
capturar el raw:

```js
// app.js — capturar raw body solo en la ruta de webhooks
app.use('/webhooks/meta', express.json({
  verify: (req, _res, buf) => { req.rawBody = buf; }
}));
```

```js
const crypto = require('crypto');

function verifyMetaSignature(req) {
  const signature = req.get('X-Hub-Signature-256');
  if (!signature) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(req.rawBody)
    .digest('hex');
  // comparación en tiempo constante
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
```

### 4.3 Recepción de eventos (POST) — responder 200 rápido, procesar async

Meta reintenta si no recibe `200` pronto. Patrón: validar firma → **encolar** →
responder `200` → procesar en worker. No procesar de forma síncrona dentro del
request HTTP.

```js
// POST /webhooks/meta/:channel
router.post('/webhooks/meta/:channel', async (req, res) => {
  if (!verifyMetaSignature(req)) return res.sendStatus(401);

  // ACK inmediato; el procesamiento real va a una cola / worker
  res.sendStatus(200);

  const { channel } = req.params;
  try {
    await enqueueMetaEvent({ channel, payload: req.body });
  } catch (err) {
    logger.error('enqueue meta event failed', { err });
    // ya respondimos 200; Meta no reintenta. Log + alerta.
  }
});
```

### 4.4 Procesamiento idempotente (worker)

El payload trae `entry[].messaging[]`. Cada item tiene `sender.id`, `recipient.id`,
`message.mid`, y el contenido. Procesar dentro de **una transacción atómica** y usar
`external_mid` para dedupe (los reintentos de Meta son normales).

```js
async function processMetaEvent({ channel, payload }) {
  for (const entry of payload.entry ?? []) {
    for (const event of entry.messaging ?? []) {
      const mid = event.message?.mid;
      if (!mid) continue; // ignorar echoes/eventos sin mensaje según política

      await db.tx(async (t) => {
        // 1) dedupe: si ya existe ese mid, salir sin tocar nada
        const exists = await t.oneOrNone(
          'SELECT 1 FROM messages WHERE external_mid = $1', [mid]
        );
        if (exists) return;

        // 2) resolver inbox por recipient (page_id / ig_account_id)
        const inbox = await t.one(
          `SELECT * FROM inboxes
             WHERE channel = $1 AND external_id = $2
             FOR UPDATE`,
          [channel, event.recipient.id]
        );

        // 3) upsert contact (scoped al inbox) -> IGSID/PSID = event.sender.id
        const contact = await upsertContact(t, inbox.id, event.sender.id);

        // 4) upsert conversation + refrescar ventana de 24hs (mensaje del usuario)
        const convo = await upsertConversation(t, inbox.id, contact.id);
        await t.none(
          `UPDATE conversations
              SET window_expires_at = now() + interval '24 hours',
                  last_message_at = now()
            WHERE id = $1`, [convo.id]
        );

        // 5) persistir mensaje (idempotente por UNIQUE external_mid)
        await t.none(
          `INSERT INTO messages
             (conversation_id, external_mid, direction, content_type, body, media_url, raw)
           VALUES ($1, $2, 'inbound', $3, $4, $5, $6)
           ON CONFLICT (external_mid) DO NOTHING`,
          [convo.id, mid, classify(event), event.message?.text ?? null,
           extractMediaUrl(event), event]
        );
      });

      // 6) fuera de la tx: notificar a los agentes (websocket), disparar bot/IA, etc.
      await notifyAndMaybeAutoReply({ channel, event });
    }
  }
}
```

Puntos no negociables de esta sección:
- **Idempotencia** por `external_mid` (UNIQUE + `ON CONFLICT DO NOTHING`).
- **Transacción atómica** y `SELECT ... FOR UPDATE` sobre el inbox para serializar
  escrituras concurrentes de la misma cuenta.
- **IDOR / scoping:** toda lectura/escritura va siempre filtrada por `inbox_id` (y
  por `org_id` si aplica multi-tenant). Nunca resolver una conversación solo por su
  id sin verificar pertenencia.

---

## 5. Envío de mensajes (Send API)

Resolver el token del inbox, chequear la ventana de mensajería, y pegarle al
endpoint de Graph correspondiente.

```js
async function sendMetaMessage({ inbox, recipientScopedId, message, convo }) {
  // política de ventana: free-form solo dentro de 24hs
  const withinWindow = convo.window_expires_at && convo.window_expires_at > new Date();
  if (!withinWindow) {
    // fuera de 24hs: solo HUMAN_AGENT (hasta 7 días) y solo soporte
    message.messaging_type = 'MESSAGE_TAG';
    message.tag = 'HUMAN_AGENT';
  }

  const base = `https://graph.facebook.com/${process.env.META_GRAPH_VERSION}`;
  const token = await decryptInboxToken(inbox); // token cifrado en DB

  const url = inbox.channel === 'instagram'
    ? `${base}/${inbox.external_id}/messages`   // IG account id
    : `${base}/${inbox.external_id}/messages`;  // page id (Messenger)

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      recipient: { id: recipientScopedId },
      message: { text: message.text },
      ...(message.messaging_type && { messaging_type: message.messaging_type }),
      ...(message.tag && { tag: message.tag }),
      access_token: token,
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new MetaSendError(data); // manejar token expirado, fuera de ventana, etc.
  return data; // contiene message_id -> persistir como outbound con external_mid
}
```

Persistir el mensaje saliente con el `message_id` que devuelve Meta como
`external_mid`, así el **echo** que llega por webhook (si lo recibís) se deduplica.

---

## 6. Manejo de errores típicos

- **Token expirado/inválido:** refrescar el token del inbox; marcar el inbox como
  `needs_reauth` y avisar. No reintentar en loop.
- **Fuera de ventana de 24hs:** capturar el error de Meta y degradar a HUMAN_AGENT
  o bloquear el envío con mensaje claro al agente.
- **Firma inválida:** `401` y log. Nunca procesar.
- **Handover / standby:** si llegan eventos `standby`, no somos primary receiver;
  decidir si pedir thread control o ignorar.
- **Reintentos de Meta:** son esperables; la idempotencia los absorbe. No alertar
  por duplicados.

---

## 7. Checklist de convenciones RS GROUP (aplicar siempre)

- [ ] Webhook **idempotente** (UNIQUE `external_mid` + `ON CONFLICT DO NOTHING`).
- [ ] **Transacciones atómicas** con `SELECT ... FOR UPDATE` en el inbox/conversación.
- [ ] **Validación HMAC** de `X-Hub-Signature-256` contra el raw body, comparación
      en tiempo constante.
- [ ] **Chequeo IDOR:** todo acceso scopeado por `inbox_id` (y tenant si aplica).
- [ ] Tokens **cifrados en reposo**, por-inbox, fuera de `.env`.
- [ ] `META_GRAPH_VERSION` **fijada explícitamente**, no "latest".
- [ ] ACK `200` inmediato + procesamiento en worker/cola.
- [ ] Media: guardar solo el **CDN URL privacy-aware** de Meta.
- [ ] Identidad de contacto **scoped por inbox** (IGSID/PSID), nunca global.

---

## 8. Orden de implementación sugerido para Claude Code

1. Migraciones de DB (sección 3).
2. Endpoint de verificación GET + validación de firma HMAC (4.1, 4.2).
3. Receptor POST con ACK inmediato + encolado (4.3).
4. Worker idempotente con la transacción atómica (4.4).
5. Send API + lógica de ventana de 24hs (5).
6. Manejo de errores y reauth de tokens (6).
7. Recién después: bot/IA de auto-respuesta y notificación a agentes por websocket.

Implementar y testear **un canal a la vez** (arrancar por Messenger o Instagram,
no los dos en paralelo) para aislar problemas de config de Meta vs. bugs de código.
El cuello de botella real suele ser App Review + permisos + handover, no el routing.

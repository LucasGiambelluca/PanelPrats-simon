#!/usr/bin/env node
/**
 * Simula un webhook entrante de Meta (Facebook Messenger / Instagram Direct)
 * contra el server local, SIN necesidad de Meta ni ngrok.
 *
 * Construye el payload con el shape real (object 'page'|'instagram', entry[].messaging[])
 * y firma el body con HMAC-SHA256 (header X-Hub-Signature-256), igual que Meta.
 * Así ejercita la cadena completa:
 *   POST /api/webhooks/meta -> verifica firma -> handleMetaWebhook
 *   -> MetaClient.handleEvent -> extractInbound -> store INBOUND
 *   -> router.processMessage -> engine -> sendMessage (graph API real)
 *
 * Requisitos: la cuenta debe existir (en Supabase o en modo memoria) con
 *   external_id == --external-id  y, para verificar firma, app_secret == --secret.
 *
 * Uso:
 *   node scripts/simulate-meta-webhook.js --external-id PAGE123 --secret APPSECRET --text "hola"
 *   node scripts/simulate-meta-webhook.js --channel instagram --external-id IG123 --secret S --text "menu"
 *   node scripts/simulate-meta-webhook.js --external-id P --no-sign            # prueba ruta insegura (META_WEBHOOK_INSECURE=1)
 *
 * Flags:
 *   --channel       facebook | instagram   (default: facebook)
 *   --external-id   ID de la página FB / cuenta IG (= entry.id)        [requerido]
 *   --secret        app_secret para firmar el body                    (omitir = sin firma)
 *   --sender        PSID/IGSID del usuario emisor   (default: USER_TEST_1)
 *   --text          texto del mensaje               (default: "hola")
 *   --url           URL del webhook   (default: http://localhost:$PORT/api/webhooks/meta)
 *   --no-sign       no enviar header de firma (para probar bypass dev)
 */

const crypto = require('crypto');
const axios = require('axios');

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (key === 'no-sign') { args.noSign = true; continue; }
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) { args[key] = true; continue; }
    args[key] = val;
    i++;
  }
  return args;
}

const args = parseArgs(process.argv);

const channel = args.channel === 'instagram' ? 'instagram' : 'facebook';
const externalId = args['external-id'];
const secret = args.secret;
const sender = args.sender || 'USER_TEST_1';
const text = args.text || 'hola';
const port = process.env.PORT || 3001;
const url = args.url || `http://localhost:${port}/api/webhooks/meta`;
const noSign = args.noSign === true || !secret;

if (!externalId) {
  console.error('ERROR: falta --external-id (debe coincidir con el external_id de la cuenta).');
  process.exit(1);
}

// object: 'page' para Messenger, 'instagram' para IG. extractInbound soporta entry.messaging.
const object = channel === 'instagram' ? 'instagram' : 'page';

const payload = {
  object,
  entry: [
    {
      id: externalId,
      time: 1700000000000, // timestamp fijo (determinístico)
      messaging: [
        {
          sender: { id: sender },
          recipient: { id: externalId },
          timestamp: 1700000000000,
          message: { mid: 'mid.test.1', text },
        },
      ],
    },
  ],
};

// Importante: firmar y enviar EXACTAMENTE el mismo string de bytes que recibe el server.
const raw = JSON.stringify(payload);

const headers = { 'Content-Type': 'application/json' };
if (!noSign && secret) {
  const sig = 'sha256=' + crypto.createHmac('sha256', secret).update(Buffer.from(raw)).digest('hex');
  headers['X-Hub-Signature-256'] = sig;
}

async function main() {
  console.log(`POST ${url}`);
  console.log(`  channel=${channel} object=${object} external_id=${externalId}`);
  console.log(`  sender=${sender} text="${text}" firma=${noSign ? 'NO' : 'sí'}`);
  try {
    const res = await axios.post(url, raw, { headers, validateStatus: () => true });
    console.log(`-> HTTP ${res.status}  body=${JSON.stringify(res.data)}`);
    if (res.status === 200) {
      console.log('OK: webhook aceptado. Mirá los logs del server para el ruteo/envío.');
    } else if (res.status === 403) {
      console.log('403: firma inválida o cuenta sin app_secret. Verificá --secret / external_id, o usá META_WEBHOOK_INSECURE=1 con --no-sign.');
    }
  } catch (err) {
    console.error('Fallo la request (¿server levantado en ese puerto?):', err.message);
    process.exit(1);
  }
}

main();

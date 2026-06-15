import { Router } from 'express';
import crypto from 'crypto';
import { supabase } from '../../config/supabase';
import { logger } from '../../utils/logger';
import type { AccountManager } from '../../core/accounts/AccountManager';

/**
 * Verifica la firma `X-Hub-Signature-256` de un webhook de Meta.
 * Formato esperado del header: `sha256=<hex>` donde hex = HMAC-SHA256(rawBody, appSecret).
 * Comparación en tiempo constante. Pura y testeable.
 */
export function verifyMetaSignature(rawBody: Buffer | string | undefined, appSecret: string | undefined, signatureHeader: string | undefined): boolean {
  if (!appSecret || !signatureHeader || rawBody == null) return false;
  const [algo, theirHex] = signatureHeader.split('=');
  if (algo !== 'sha256' || !theirHex) return false;

  const body = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(rawBody);
  const expected = crypto.createHmac('sha256', appSecret).update(body).digest('hex');

  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(theirHex, 'hex');
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/**
 * Router del webhook de Meta (Facebook Messenger + Instagram Direct).
 * Montado en `/api/webhooks/meta`.
 *
 * - GET `/`  → verificación de Meta (hub.mode/hub.verify_token/hub.challenge).
 * - POST `/` → recepción de eventos: verifica firma, enruta cada `entry` por
 *   `external_id` al MetaClient correspondiente vía el AccountManager.
 *
 * Requiere que app.ts capture el raw body en `req.rawBody` (ver express.json verify).
 */
export function metaWebhookRouter(manager: AccountManager): Router {
  const r = Router();

  // Verificación del webhook (Meta hace GET al configurar la suscripción).
  r.get('/', async (req, res) => {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    if (mode !== 'subscribe' || typeof token !== 'string' || !token) {
      return res.sendStatus(403);
    }

    try {
      const { data } = await supabase
        .from('accounts')
        .select('id')
        .eq('verify_token', token)
        .limit(1);

      if (data && data.length > 0) {
        return res.status(200).send(String(challenge ?? ''));
      }
    } catch (err: any) {
      logger.error(`[meta-webhook] error verificando token: ${err?.message ?? err}`);
    }
    return res.sendStatus(403);
  });

  // Recepción de eventos.
  r.post('/', async (req, res) => {
    const body = req.body ?? {};
    const object = body.object; // 'page' (FB) | 'instagram' (IG)
    const entries: any[] = Array.isArray(body.entry) ? body.entry : [];

    // Verificamos firma contra el app_secret de la(s) cuenta(s) involucradas.
    const signature = req.header('X-Hub-Signature-256');
    const rawBody = (req as any).rawBody as Buffer | undefined;

    try {
      for (const entry of entries) {
        const externalId = entry?.id;
        if (!externalId) continue;

        const { data } = await supabase
          .from('accounts')
          .select('app_secret')
          .eq('external_id', externalId)
          .limit(1);

        const appSecret = data?.[0]?.app_secret as string | undefined;
        if (!verifyMetaSignature(rawBody, appSecret, signature)) {
          logger.warn(`[meta-webhook] firma inválida para external_id=${externalId} (object=${object})`);
          return res.sendStatus(403);
        }

        await manager.handleMetaWebhook(entry);
      }
    } catch (err: any) {
      // No reventamos: Meta exige 200 rápido; logueamos y seguimos.
      logger.error(`[meta-webhook] error procesando evento: ${err?.message ?? err}`);
    }

    return res.sendStatus(200);
  });

  return r;
}

import { redis } from '../config/redis';
import { logger } from '../utils/logger';

/**
 * Idempotencia de webhooks entrantes.
 *
 * Meta reintenta la entrega de un webhook hasta ~38h si no recibe 200 a tiempo.
 * Sin deduplicación, el mismo mensaje se procesaría más de una vez: respuesta
 * duplicada al cliente y doble avance del flujo (doble turno, doble acción).
 *
 * Usamos `SET key NX EX ttl` (operación atómica de Redis) como "claim": el
 * primer webhook que reclama el id procesa; los reintentos posteriores ven la
 * clave ya presente y se descartan.
 */

// Meta reintenta hasta ~38h; 48h de margen.
const DEDUPE_TTL_SECONDS = 60 * 60 * 48;

/**
 * Reclama el procesamiento de un mensaje por su id.
 * @returns `true` si es la primera vez (hay que procesarlo), `false` si ya se vio (descartar).
 *
 * Fail-open: si Redis no está disponible se devuelve `true` (se procesa). Perder
 * un mensaje de un cliente es peor que un duplicado ocasional cuando Redis cae.
 */
export async function claimWebhookMessage(
  messageId: string | undefined | null,
  ttlSeconds: number = DEDUPE_TTL_SECONDS,
): Promise<boolean> {
  if (!messageId) return true; // sin id no se puede deduplicar: procesar
  const key = `wh:dedupe:${messageId}`;
  try {
    const res = await redis.set(key, '1', 'EX', ttlSeconds, 'NX');
    return res === 'OK'; // 'OK' = recién reclamado; null = ya existía
  } catch (err: any) {
    logger.warn(`[idempotency] Redis no disponible para dedupe de ${messageId}, se procesa igual: ${err?.message ?? err}`);
    return true;
  }
}

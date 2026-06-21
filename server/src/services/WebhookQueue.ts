import { redis } from '../config/redis';
import { logger } from '../utils/logger';
import { captureException } from '../config/errorTracking';
import type { AccountManager } from '../core/accounts/AccountManager';

/**
 * WebhookQueue — procesamiento asíncrono y durable de webhooks entrantes.
 *
 * Problema (A1): hasta ahora el webhook se procesaba inline dentro del request.
 * Si `handle*Webhook` fallaba a mitad, el evento se perdía (ya se había devuelto
 * 200 a Meta, que no reintenta lo que recibió OK). Un mensaje de cliente perdido.
 *
 * Solución: el request solo VERIFICA la firma y ENCOLA el `entry` en una lista
 * Redis durable, devolviendo 200 rápido (lo que Meta exige). Un worker en
 * background drena la cola y procesa con reintentos + backoff exponencial; tras
 * agotar los intentos, el job va a una dead-letter para inspección manual.
 *
 * Garantías:
 *  - Sin pérdida: el evento queda en Redis antes de devolver 200. Si el proceso
 *    muere a mitad, `recoverProcessing()` lo rescata de `wh:processing` al boot.
 *  - Reproceso seguro: la idempotencia de B1 (services/idempotency.ts) evita
 *    respuestas/avances duplicados si un job se ejecuta más de una vez.
 *  - Fail-safe: si Redis no está disponible al encolar, el caller (webhook route)
 *    cae a procesamiento inline para no perder el evento.
 *
 * Patrón de cola confiable: `RPOPLPUSH wh:queue -> wh:processing` (atómico, a
 * prueba de crash), `LREM` de processing al terminar. Backoff vía ZSET `wh:retry`
 * scoreado por `readyAt` (ms epoch); cada tick promueve los vencidos a la cola.
 */

export type WebhookKind = 'whatsapp' | 'meta';

interface WebhookJob {
  kind: WebhookKind;
  entry: any;
  attempts: number;
}

const QUEUE = 'wh:queue';
const PROCESSING = 'wh:processing';
const RETRY = 'wh:retry';
const DEADLETTER = 'wh:deadletter';

const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 2000; // 2s, 4s, 8s, 16s

export class WebhookQueue {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly TICK_MS = 1000;
  private readonly BATCH = 20; // jobs procesados por tick (evita acaparar el event loop)

  constructor(private manager: AccountManager) {}

  /**
   * Encola un `entry` ya verificado. Lanza si Redis no está disponible: el caller
   * debe capturarlo y procesar inline (fail-safe, no perder el evento).
   */
  async enqueue(kind: WebhookKind, entry: any): Promise<void> {
    const job: WebhookJob = { kind, entry, attempts: 0 };
    await redis.lpush(QUEUE, JSON.stringify(job));
  }

  start(): void {
    if (this.timer) return;
    this.recoverProcessing().catch((e) => logger.error(`[WebhookQueue] recover error: ${e?.message ?? e}`));
    this.timer = setInterval(() => {
      this.tick().catch((e) => logger.error(`[WebhookQueue] tick error: ${e?.message ?? e}`));
    }, this.TICK_MS);
    logger.info('📨 [WebhookQueue] worker activo (async + retry/backoff + dead-letter)');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  /** Rescata jobs que quedaron en `wh:processing` si el server murió a mitad. */
  private async recoverProcessing(): Promise<void> {
    let moved = 0;
    // eslint-disable-next-line no-await-in-loop
    while (await redis.rpoplpush(PROCESSING, QUEUE)) moved++;
    if (moved) logger.warn(`[WebhookQueue] recuperados ${moved} jobs en proceso tras reinicio`);
  }

  async tick(): Promise<void> {
    if (this.running) return; // evita solapamiento si un tick tarda
    this.running = true;
    try {
      await this.promoteDueRetries();
      for (let i = 0; i < this.BATCH; i++) {
        const raw = await redis.rpoplpush(QUEUE, PROCESSING);
        if (!raw) break;
        await this.process(raw);
      }
    } finally {
      this.running = false;
    }
  }

  /** Mueve a la cola los retries cuyo `readyAt` ya venció. */
  private async promoteDueRetries(): Promise<void> {
    const now = Date.now();
    const due = await redis.zrangebyscore(RETRY, '-inf', now, 'LIMIT', 0, this.BATCH);
    for (const raw of due) {
      // ZREM antes de LPUSH: el que gana el ZREM es el único que reencola.
      const removed = await redis.zrem(RETRY, raw);
      if (removed) await redis.lpush(QUEUE, raw);
    }
  }

  private async process(raw: string): Promise<void> {
    let job: WebhookJob;
    try {
      job = JSON.parse(raw);
    } catch {
      await redis.lrem(PROCESSING, 1, raw);
      logger.error('[WebhookQueue] job ilegible descartado');
      return;
    }

    try {
      if (job.kind === 'whatsapp') await this.manager.handleWhatsAppWebhook(job.entry);
      else await this.manager.handleMetaWebhook(job.entry);
      await redis.lrem(PROCESSING, 1, raw);
    } catch (err: any) {
      await redis.lrem(PROCESSING, 1, raw);
      const attempts = job.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) {
        await redis.lpush(
          DEADLETTER,
          JSON.stringify({ ...job, attempts, failedAt: Date.now(), error: String(err?.message ?? err) }),
        );
        logger.error(`[WebhookQueue] job a dead-letter tras ${attempts} intentos: ${err?.message ?? err}`);
        captureException(err, { kind: job.kind, attempts });
      } else {
        const delay = BASE_BACKOFF_MS * Math.pow(2, attempts - 1);
        const readyAt = Date.now() + delay;
        await redis.zadd(RETRY, readyAt, JSON.stringify({ ...job, attempts }));
        logger.warn(`[WebhookQueue] job falla (intento ${attempts}/${MAX_ATTEMPTS}), reintenta en ${delay}ms: ${err?.message ?? err}`);
      }
    }
  }
}

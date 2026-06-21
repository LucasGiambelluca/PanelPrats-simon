import { logger } from '../utils/logger';

/**
 * Error tracking (A9). Abstracción fina sobre Sentry:
 *  - Solo se inicializa si `SENTRY_DSN` está seteado; si no, es no-op (cero overhead).
 *  - El resto del código llama `captureException` sin saber si hay Sentry o no.
 *
 * Import perezoso de `@sentry/node`: no se carga la librería si no hay DSN.
 */

let client: any = null;
let initialized = false;

export function initErrorTracking(): void {
  if (initialized) return;
  initialized = true;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    logger.info('[errorTracking] SENTRY_DSN no seteado: tracking deshabilitado (no-op).');
    return;
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const Sentry = require('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'development',
      tracesSampleRate: 0,
    });
    client = Sentry;
    logger.info('[errorTracking] Sentry inicializado.');
  } catch (err: any) {
    logger.error(`[errorTracking] no se pudo inicializar Sentry: ${err?.message ?? err}`);
  }
}

export function captureException(err: unknown, context?: Record<string, any>): void {
  if (!client) return;
  try {
    client.captureException(err, context ? { extra: context } : undefined);
  } catch {
    // nunca dejar que el tracking tumbe el flujo principal
  }
}

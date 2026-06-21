import { logger } from './logger';

/**
 * Reintento con backoff exponencial para llamadas a servicios externos.
 *
 * Solo reintenta errores TRANSITORIOS: fallos de red/timeout (sin respuesta) y
 * respuestas HTTP 429 (rate limit) o 5xx (error del servidor). Los 4xx (token
 * inválido, destinatario inexistente, payload mal formado) son permanentes:
 * reintentarlos no cambia el resultado y solo agrega latencia → se relanzan ya.
 */

export interface RetryOptions {
  attempts?: number;      // intentos totales (default 3)
  baseDelayMs?: number;   // demora del primer reintento (default 500); duplica cada vez
  label?: string;         // etiqueta para el log
}

/** Determina si vale la pena reintentar el error (axios u otro). */
export function isRetryable(err: any): boolean {
  // Error de red / timeout: axios no trae `response`.
  if (err && err.response == null) return true;
  const status = err?.response?.status;
  return status === 429 || (typeof status === 'number' && status >= 500);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function withRetry<T>(fn: () => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const label = opts.label ?? 'request';

  let lastErr: any;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      lastErr = err;
      if (attempt === attempts || !isRetryable(err)) throw err;
      const delay = baseDelayMs * 2 ** (attempt - 1);
      const status = err?.response?.status ?? 'network';
      logger.warn(`[retry] ${label} falló (intento ${attempt}/${attempts}, ${status}), reintenta en ${delay}ms`);
      await sleep(delay);
    }
  }
  throw lastErr; // inalcanzable; satisface el tipo
}

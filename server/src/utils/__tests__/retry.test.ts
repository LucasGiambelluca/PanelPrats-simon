import { describe, it, expect, vi } from 'vitest';

vi.mock('../logger', () => ({ logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { withRetry, isRetryable } from '../retry';

const axiosErr = (status?: number) => (status == null ? { message: 'ECONNRESET' } : { response: { status } });

describe('isRetryable', () => {
  it('reintenta red/timeout (sin response), 429 y 5xx', () => {
    expect(isRetryable(axiosErr())).toBe(true);     // sin response
    expect(isRetryable(axiosErr(429))).toBe(true);
    expect(isRetryable(axiosErr(500))).toBe(true);
    expect(isRetryable(axiosErr(503))).toBe(true);
  });
  it('NO reintenta 4xx permanentes', () => {
    expect(isRetryable(axiosErr(400))).toBe(false);
    expect(isRetryable(axiosErr(401))).toBe(false);
    expect(isRetryable(axiosErr(404))).toBe(false);
  });
});

describe('withRetry', () => {
  it('éxito al primer intento: no reintenta', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    expect(await withRetry(fn, { baseDelayMs: 0 })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('reintenta error transitorio y luego tiene éxito', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(axiosErr(503))
      .mockRejectedValueOnce(axiosErr())
      .mockResolvedValue('ok');
    expect(await withRetry(fn, { attempts: 3, baseDelayMs: 0 })).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('no reintenta un 4xx: relanza al toque', async () => {
    const fn = vi.fn().mockRejectedValue(axiosErr(400));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toMatchObject({ response: { status: 400 } });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('agota los intentos y relanza el último error', async () => {
    const fn = vi.fn().mockRejectedValue(axiosErr(500));
    await expect(withRetry(fn, { attempts: 3, baseDelayMs: 0 })).rejects.toMatchObject({ response: { status: 500 } });
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

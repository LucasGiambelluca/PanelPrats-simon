import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock del cliente Redis antes de importar el módulo bajo prueba.
const set = vi.fn();
vi.mock('../../config/redis', () => ({ redis: { set: (...a: any[]) => set(...a) } }));

import { claimWebhookMessage } from '../idempotency';

describe('claimWebhookMessage', () => {
  beforeEach(() => { set.mockReset(); });

  it('primera vez => true (reclamado) y usa SET NX EX', async () => {
    set.mockResolvedValue('OK');
    const ok = await claimWebhookMessage('wamid.123');
    expect(ok).toBe(true);
    expect(set).toHaveBeenCalledWith('wh:dedupe:wamid.123', '1', 'EX', expect.any(Number), 'NX');
  });

  it('segunda vez (clave ya existe) => false (descartar)', async () => {
    set.mockResolvedValue(null);
    expect(await claimWebhookMessage('wamid.123')).toBe(false);
  });

  it('sin id => true (no se puede deduplicar, se procesa)', async () => {
    expect(await claimWebhookMessage(undefined)).toBe(true);
    expect(await claimWebhookMessage('')).toBe(true);
    expect(set).not.toHaveBeenCalled();
  });

  it('fail-open: si Redis tira error => true (se procesa igual)', async () => {
    set.mockRejectedValue(new Error('ECONNREFUSED'));
    expect(await claimWebhookMessage('wamid.x')).toBe(true);
  });
});

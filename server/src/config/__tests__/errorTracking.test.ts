import { describe, it, expect, vi } from 'vitest';

vi.mock('../../utils/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { initErrorTracking, captureException } from '../errorTracking';

describe('errorTracking sin SENTRY_DSN', () => {
  it('init no rompe y captureException es no-op (no lanza)', () => {
    const prev = process.env.SENTRY_DSN;
    delete process.env.SENTRY_DSN;
    expect(() => initErrorTracking()).not.toThrow();
    expect(() => captureException(new Error('x'), { a: 1 })).not.toThrow();
    if (prev !== undefined) process.env.SENTRY_DSN = prev;
  });
});

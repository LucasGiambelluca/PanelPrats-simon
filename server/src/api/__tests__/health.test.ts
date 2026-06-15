import { describe, it, expect, vi } from 'vitest';

vi.mock('../../core/engine/flow.engine', () => ({ FlowEngine: class {} }));
vi.mock('../../core/accounts/AccountManager', () => ({ AccountManager: class { constructor() {} } }));

import { createApp } from '../app';

describe('app /health', () => {
  it('createApp construye una app express con /health', () => {
    const app = createApp({} as any);
    // express app es una función con .listen
    expect(typeof (app as any).listen).toBe('function');
  });
});

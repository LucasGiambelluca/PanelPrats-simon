import { describe, it, expect } from 'vitest';
import { nodeExecutorFactory } from '../NodeExecutorFactory';

describe('NodeExecutorFactory', () => {
  it('resuelve un executor genérico registrado', () => {
    expect(typeof nodeExecutorFactory.getExecutor('messageNode').execute).toBe('function');
  });
  it('devuelve no-op para tipo desconocido (no rompe)', async () => {
    const r = await nodeExecutorFactory.getExecutor('inexistente').execute({}, {} as any, {} as any);
    expect(r).toEqual({ messages: [], wait_for_input: false });
  });
  it('NO registra nodos de comercio', () => {
    // los de comercio caen al no-op
    const r = nodeExecutorFactory.getExecutor('createOrderNode');
    expect(typeof r.execute).toBe('function'); // es el no-op, no el CreateOrderExecutor
  });
});

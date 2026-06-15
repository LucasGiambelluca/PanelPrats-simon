import { describe, it, expect } from 'vitest';
import { ConditionExecutor } from '../ConditionExecutor';

describe('ConditionExecutor numeric + unknown op', () => {
  it('greater_than with numeric values works', async () => {
    const ex = new ConditionExecutor();
    const res = await ex.execute({ variable: 'n', operator: 'greater_than', expectedValue: '5' }, { phone: 'x', n: '10' } as any, {});
    expect(res.conditionResult).toBe(true);
  });

  it('greater_than with non-numeric input is false', async () => {
    const ex = new ConditionExecutor();
    const res = await ex.execute({ variable: 'n', operator: 'greater_than', expectedValue: '5' }, { phone: 'x', n: 'hola' } as any, {});
    expect(res.conditionResult).toBe(false);
  });

  it('unknown operator falls back to equals semantics', async () => {
    const ex = new ConditionExecutor();
    const res = await ex.execute({ variable: 'n', operator: 'wat', expectedValue: 'si' }, { phone: 'x', n: 'si' } as any, {});
    expect(res.conditionResult).toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const interpret = vi.fn();
vi.mock('../../../services/SupervisorService', () => ({ SupervisorService: { interpret } }));

import { evaluate } from '../ConversationGate';

beforeEach(() => interpret.mockReset());

describe('gateo con reintentos', () => {
  it('primer no-match → reprompt (no IA)', () => {
    const d = evaluate({ input: 'mmm', expectedOptions: ['A', 'B'], retryCount: 0, maxRetries: 1 });
    expect(d.decision).toBe('reprompt');
    expect(interpret).not.toHaveBeenCalled();
  });
  it('segundo no-match → escalate', () => {
    const d = evaluate({ input: 'mmm', expectedOptions: ['A', 'B'], retryCount: 1, maxRetries: 1 });
    expect(d).toEqual({ decision: 'escalate', reason: 'retry_exhausted' });
  });
});

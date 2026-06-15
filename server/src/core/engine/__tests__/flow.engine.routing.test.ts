import { describe, it, expect, vi } from 'vitest';

// Instantiating FlowEngine builds a SessionRepository which imports the supabase
// client. Mock the database shim so no real client is created.
vi.mock('../../../config/database', () => {
  const chain: any = {
    select: () => chain, eq: () => chain, in: () => chain, order: () => chain,
    limit: () => chain, maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
    insert: () => Promise.resolve({ data: null, error: null }),
    update: () => chain, delete: () => chain,
  };
  return { supabase: { from: () => chain }, redis: {} };
});

import { FlowEngine } from '../flow.engine';

// findNextNodeId es privado; lo probamos vía un acceso de test.
// @ts-expect-error acceso a método privado para testing
const findNext = (FlowEngine.prototype as any).findNextNodeId.bind(new FlowEngine());

const flow = {
  nodes: [{ id: 'cond', type: 'conditionNode' }, { id: 'yes' }, { id: 'no' }],
  edges: [
    { source: 'cond', target: 'yes', sourceHandle: 'true' },
    { source: 'cond', target: 'no', sourceHandle: 'false' },
  ],
} as any;

describe('FlowEngine.findNextNodeId', () => {
  it('matchea handle exacto', () => {
    expect(findNext(flow, 'cond', 'true')).toBe('yes');
  });
  it('matchea por sinónimo booleano (si → true)', () => {
    expect(findNext(flow, 'cond', 'confirmed')).toBe('yes');
  });
  it('handle negativo va a false', () => {
    expect(findNext(flow, 'cond', 'cancelar')).toBe('no');
  });
});

import { describe, it, expect, vi, beforeEach } from 'vitest';

const captured: any = { eqArgs: [], insertArg: null };

vi.mock('../../../config/database', () => {
  const chain: any = {
    select: () => chain,
    eq: (k: string, v: any) => { captured.eqArgs.push([k, v]); return chain; },
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    single: () => Promise.resolve({ data: null, error: null }),
    insert: (o: any) => {
      captured.insertArg = o;
      return { select: () => ({ single: () => Promise.resolve({ data: { ...o, id: 'x' }, error: null }) }) };
    },
    update: () => chain,
    delete: () => chain,
  };
  return { supabase: { from: () => chain }, redis: {} };
});

import { SessionRepository } from '../SessionRepository';

describe('SessionRepository accountId', () => {
  beforeEach(() => { captured.eqArgs = []; captured.insertArg = null; });

  it('findActiveSession filtra por account_id', async () => {
    const repo = new SessionRepository();
    await repo.findActiveSession('accA', 'accA:1to1:549111');
    expect(captured.eqArgs).toContainEqual(['account_id', 'accA']);
  });
});

import { describe, it, expect, vi } from 'vitest';

const captured: any = { upsert: null, insert: null };
vi.mock('../../config/supabase', () => {
  const chain: any = {
    upsert: (o: any) => { captured.upsert = o; return { select: () => ({ single: () => Promise.resolve({ data: { id: 'conv1' }, error: null }) }) }; },
    insert: (o: any) => { captured.insert = o; return Promise.resolve({ error: null }); },
  };
  return { supabase: { from: () => chain } };
});

import { messageStore } from '../MessageStore';

describe('MessageStore', () => {
  it('record upserta conversación con account_id e inserta el mensaje', async () => {
    await messageStore.record({ accountId: 'accA', phone: '549111', direction: 'INBOUND', content: 'hola' });
    expect(captured.upsert.account_id).toBe('accA');
    expect(captured.upsert.phone).toBe('549111');
    expect(captured.insert.conversation_id).toBe('conv1');
    expect(captured.insert.direction).toBe('INBOUND');
  });
});

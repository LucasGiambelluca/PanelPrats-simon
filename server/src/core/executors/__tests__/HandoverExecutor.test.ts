import { describe, it, expect, vi } from 'vitest';
import { HandoverExecutor } from '../HandoverExecutor';

/**
 * Stub del query builder de supabase que registra cada llamada a .eq(col, val)
 * por tabla, para verificar el aislamiento por cuenta (account_id).
 */
function makeDbStub() {
  const eqCalls: Record<string, [string, any][]> = {};
  const updatedByTable: Record<string, any> = {};

  function builderFor(table: string) {
    eqCalls[table] = eqCalls[table] || [];
    const builder: any = {
      update: vi.fn((payload: any) => { updatedByTable[table] = payload; return builder; }),
      eq: vi.fn((col: string, val: any) => { eqCalls[table].push([col, val]); return builder; }),
    };
    return builder;
  }

  return {
    db: { from: vi.fn((table: string) => builderFor(table)) },
    eqCalls,
    updatedByTable,
  };
}

describe('HandoverExecutor cross-account isolation', () => {
  it('aplica eq(account_id, ...) a flow_executions y whatsapp_conversations', async () => {
    const stub = makeDbStub();
    const ex = new HandoverExecutor();

    await ex.execute(
      { message: 'Transferimos a un humano' },
      { phone: '549111', accountId: 'accA' } as any,
      { db: stub.db }
    );

    // Ambas tablas reciben el filtro de cuenta con el accountId del contexto.
    expect(stub.eqCalls['flow_executions']).toContainEqual(['account_id', 'accA']);
    expect(stub.eqCalls['whatsapp_conversations']).toContainEqual(['account_id', 'accA']);

    // status válido según el CHECK constraint, sin paused_at (columna inexistente).
    expect(stub.updatedByTable['whatsapp_conversations'].status).toBe('HANDOVER');
    expect(stub.updatedByTable['whatsapp_conversations']).not.toHaveProperty('paused_at');
    expect(stub.updatedByTable['flow_executions'].status).toBe('HANDOVER');
    expect(stub.updatedByTable['flow_executions']).not.toHaveProperty('paused_at');
  });
});

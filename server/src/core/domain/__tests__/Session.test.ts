import { describe, it, expect } from 'vitest';
import { Session } from '../Session';

// El shape real de `fromJSON` (ver Session.ts) usa session_id / phone /
// current_node_id / flow_id y un `context` con variables.{global,shared,<flowId>}.
// El namespace del flujo actual lo determina context.metadata.flowId.
function makeSession() {
  return Session.fromJSON({
    session_id: 'acc1:1to1:549111',
    phone: '549111',
    current_node_id: 'start',
    status: 'active',
    flow_id: 'flow-1',
    context: {
      variables: { global: {}, shared: {}, 'flow-1': {} },
      interactionLog: [],
      metadata: { flowId: 'flow-1', flowVersion: 1, entryPoint: 'trigger' },
    },
  });
}

describe('Session', () => {
  it('setVariable escribe en el namespace del flujo actual y getVariable lo lee', () => {
    const s = makeSession();
    s.setVariable('nombre', 'Lucas');
    expect(s.getVariable('nombre')).toBe('Lucas');
  });

  it('getAllVariablesForCurrentFlow mergea global + shared + flujo', () => {
    const s = makeSession();
    // setGlobalVariable escribe en el namespace `shared`.
    s.setGlobalVariable('phone', '549111');
    s.setVariable('nombre', 'Lucas');
    const all = s.getAllVariablesForCurrentFlow();
    expect(all.phone).toBe('549111');
    expect(all.nombre).toBe('Lucas');
  });
});

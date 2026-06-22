import { describe, it, expect, vi } from 'vitest';

let accountRow: any = { agent_mode: 'flows' };
vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: accountRow }) }) }) }) },
}));

const agentHandle = vi.fn().mockResolvedValue(['respuesta del agente']);
vi.mock('../../agent/runtime/createAgentRuntime', () => ({
  getAgentRuntime: () => ({ handle: agentHandle }),
}));

import { ConversationRouter } from '../conversation.router';

function makeEngine() {
  return { processMessage: vi.fn().mockResolvedValue({ messages: ['flujo'] }), forceReset: vi.fn() } as any;
}

describe('ConversationRouter gate agent_mode', () => {
  it("con agent_mode='ai_first' usa el AgentRuntime y NO el FlowEngine", async () => {
    accountRow = { agent_mode: 'ai_first' };
    const engine = makeEngine();
    const out = await new ConversationRouter(engine).processMessage('acc1', '549111', 'hola que tal', 'Lucas');
    expect(agentHandle).toHaveBeenCalledWith('acc1', '549111', 'hola que tal', expect.anything());
    expect(engine.processMessage).not.toHaveBeenCalled();
    expect(out).toEqual(['respuesta del agente']);
  });

  it("con agent_mode='flows' usa el FlowEngine (camino actual)", async () => {
    accountRow = { agent_mode: 'flows' };
    const engine = makeEngine();
    await new ConversationRouter(engine).processMessage('acc1', '549111', 'algo off-script xyz', 'Lucas');
    expect(engine.processMessage).toHaveBeenCalled();
  });
});

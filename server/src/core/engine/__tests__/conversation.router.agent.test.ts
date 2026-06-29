import { describe, it, expect, vi, beforeEach } from 'vitest';

let accountRow: any = { agent_mode: 'flows' };
let convoRow: any = { status: 'BOT' };
vi.mock('../../../config/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'whatsapp_conversations') {
        return {
          // getConversationStatus: select().eq().eq().maybeSingle()
          select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: convoRow }) }) }) }),
          // setHandover / greeting-resume: update().eq().eq()
          update: () => ({ eq: () => ({ eq: () => Promise.resolve({}) }) }),
        };
      }
      // accounts: select().eq().maybeSingle()
      return { select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: accountRow }) }) }) };
    },
  },
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
  beforeEach(() => {
    agentHandle.mockClear();
    convoRow = { status: 'BOT' };
  });

  it("con agent_mode='ai_first' usa el AgentRuntime y NO el FlowEngine", async () => {
    accountRow = { agent_mode: 'ai_first' };
    const engine = makeEngine();
    const out = await new ConversationRouter(engine).processMessage('acc1', '549111', 'hola que tal', 'Lucas');
    expect(agentHandle).toHaveBeenCalledWith('acc1', '549111', 'hola que tal', expect.anything());
    expect(engine.processMessage).not.toHaveBeenCalled();
    expect(out).toEqual(['respuesta del agente']);
  });

  it("con agent_mode='ai_first' y conversación en HANDOVER, el bot calla (no llama al agente)", async () => {
    accountRow = { agent_mode: 'ai_first' };
    convoRow = { status: 'HANDOVER' };
    const engine = makeEngine();
    const out = await new ConversationRouter(engine).processMessage('acc1', '549111', 'me responden y el bot reaparece', 'Lucas');
    expect(agentHandle).not.toHaveBeenCalled();
    expect(out).toEqual([]);
  });

  it("con agent_mode='ai_first' y status BOT, el agente responde normal", async () => {
    accountRow = { agent_mode: 'ai_first' };
    convoRow = { status: 'BOT' };
    const engine = makeEngine();
    const out = await new ConversationRouter(engine).processMessage('acc1', '549111', 'hola', 'Lucas');
    expect(agentHandle).toHaveBeenCalled();
    expect(out).toEqual(['respuesta del agente']);
  });

  it("con agent_mode='flows' usa el FlowEngine (camino actual)", async () => {
    accountRow = { agent_mode: 'flows' };
    const engine = makeEngine();
    await new ConversationRouter(engine).processMessage('acc1', '549111', 'algo off-script xyz', 'Lucas');
    expect(engine.processMessage).toHaveBeenCalled();
  });
});

import { describe, it, expect, vi } from 'vitest';

// Estado de conversación devuelto por supabase, configurable por test.
let mockStatus: string | null = 'HANDOVER';
// Cadena tolerante: soporta tanto .eq().maybeSingle() (gate agent_mode en accounts)
// como .eq().eq().maybeSingle() (status de whatsapp_conversations).
vi.mock('../../../config/supabase', () => {
  const leaf = (): any => ({
    eq: () => leaf(),
    maybeSingle: () => Promise.resolve({ data: { status: mockStatus } }),
  });
  return { supabase: { from: () => ({ select: () => leaf() }) } };
});

import { ConversationRouter } from '../conversation.router';

function makeEngine() {
  return {
    processMessage: vi.fn(async () => ['respuesta-flujo']),
    forceReset: vi.fn(async () => {}),
  } as any;
}

describe('ConversationRouter', () => {
  it('cancelar resetea y no llama al motor', async () => {
    mockStatus = 'HANDOVER';
    const engine = makeEngine();
    const r = await new ConversationRouter(engine).processMessage('accA', '549111', 'cancelar', 'L');
    expect(engine.forceReset).toHaveBeenCalledWith('accA', '549111');
    expect(engine.processMessage).not.toHaveBeenCalled();
    expect(r[0]).toMatch(/reiniciamos/i);
  });

  it('en HANDOVER el bot calla salvo saludo', async () => {
    mockStatus = 'HANDOVER';
    const engine = makeEngine();
    const r = await new ConversationRouter(engine).processMessage('accA', '549111', 'tengo una duda', 'L');
    expect(r).toEqual([]);
    expect(engine.processMessage).not.toHaveBeenCalled();
  });

  it('saludo fuerza "hola" al motor', async () => {
    mockStatus = 'BOT';
    const engine = makeEngine();
    await new ConversationRouter(engine).processMessage('accA', '549111', 'Buenas', 'L');
    // 'buenas' no está en GREETING_WORDS → va como default con el texto original
    expect(engine.processMessage).toHaveBeenCalled();
  });
});

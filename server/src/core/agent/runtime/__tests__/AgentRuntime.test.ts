import { describe, it, expect, vi } from 'vitest';
import { AgentRuntime } from '../AgentRuntime';

function makeDeps(aiScript: any[]) {
  let i = 0;
  return {
    ai: { completeWithTools: vi.fn(async () => aiScript[i++]) },
    persona: { build: vi.fn(() => 'system') },
    memory: { load: vi.fn().mockResolvedValue({ profile: {}, preferences: {}, summary: null, fichaText: 'FICHA: nuevo.' }) },
    tools: { schemas: vi.fn(() => []), execute: vi.fn() },
    loadAccount: vi.fn().mockResolvedValue({ accountId: 'acc1', agentName: 'Sofía' }),
    history: vi.fn().mockResolvedValue([]),
    updateMemory: vi.fn().mockResolvedValue(undefined),
  };
}

describe('AgentRuntime.handle', () => {
  it('responde directo cuando el modelo no pide tools', async () => {
    const deps = makeDeps([{ content: 'Hola, soy Sofía' }]);
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'hola', {});
    expect(out).toEqual(['Hola, soy Sofía']);
    expect(deps.tools.execute).not.toHaveBeenCalled();
  });

  it('ejecuta una tool y vuelve a llamar al modelo con el resultado', async () => {
    const deps = makeDeps([
      { toolCalls: [{ id: 'c1', name: 'search_knowledge', args: { query: 'moratoria' } }] },
      { content: 'Sí, gestionamos moratoria.' },
    ]);
    deps.tools.execute = vi.fn().mockResolvedValue({ ok: true, data: { encontrado: true, snippets: ['x'] } });
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', '¿moratoria?', {});
    expect(deps.tools.execute).toHaveBeenCalledWith('search_knowledge', { query: 'moratoria' }, { accountId: 'acc1', phone: '549111' });
    expect(out).toEqual(['Sí, gestionamos moratoria.']);
  });

  it('corta y deriva si supera el máximo de iteraciones', async () => {
    const loopResp = { toolCalls: [{ id: 'c', name: 'search_knowledge', args: {} }] };
    const deps = makeDeps(Array(20).fill(loopResp));
    deps.tools.execute = vi.fn().mockResolvedValue({ ok: true, data: {} });
    const rt = new AgentRuntime(deps as any);
    const out = await rt.handle('acc1', '549111', 'loop', {});
    expect(out[0].toLowerCase()).toContain('persona'); // mensaje de cortesía + derivación
    expect(deps.ai.completeWithTools.mock.calls.length).toBeLessThanOrEqual(6);
  });
});

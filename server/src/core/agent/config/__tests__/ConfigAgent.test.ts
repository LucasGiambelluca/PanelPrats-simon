import { describe, it, expect, vi } from 'vitest';
import { ConfigAgent } from '../ConfigAgent';
import { ConfigToolRegistry } from '../ConfigToolRegistry';
import type { BrainState } from '../types';

const state: BrainState = { tono: 'neutro', datos: 'L-V 9-18', procedimientos: null, faqs: [], zonas: [], lineas: 4 };

it('mapea las tool-calls del modelo a pendingChanges', async () => {
  const ai = { completeWithTools: vi.fn().mockResolvedValue({ toolCalls: [
    { id: 'c1', name: 'set_tono', args: { texto: 'cálido con mayores' } },
    { id: 'c2', name: 'add_faq', args: { pregunta: '¿precio?', respuesta: '$29.000' } },
  ] }) };
  const agent = new ConfigAgent({ ai, registry: new ConfigToolRegistry() });
  const r = await agent.handle([{ role: 'user', content: 'sé más cálido y agregá el precio' }], state);
  expect(r.pendingChanges).toHaveLength(2);
  expect(r.pendingChanges[0]).toMatchObject({ type: 'set_tono' });
  expect(r.reply).toBeTruthy();
});

it('si el modelo responde texto (sin tools), no propone cambios', async () => {
  const ai = { completeWithTools: vi.fn().mockResolvedValue({ content: 'Listo, ¿algo más?' }) };
  const agent = new ConfigAgent({ ai, registry: new ConfigToolRegistry() });
  const r = await agent.handle([{ role: 'user', content: 'gracias' }], state);
  expect(r.pendingChanges).toHaveLength(0);
  expect(r.reply).toBe('Listo, ¿algo más?');
});

it('descarta tool-calls inválidas (no las propone)', async () => {
  const ai = { completeWithTools: vi.fn().mockResolvedValue({ toolCalls: [{ id: 'c1', name: 'add_zona', args: { localidad: 'X', oficina: 'Marte' } }] }) };
  const agent = new ConfigAgent({ ai, registry: new ConfigToolRegistry() });
  const r = await agent.handle([{ role: 'user', content: 'x' }], state);
  expect(r.pendingChanges).toHaveLength(0);
});

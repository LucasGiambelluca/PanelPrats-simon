import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/supabase', () => ({ supabase: {} }));

const extractJSON = vi.fn();
vi.mock('../AIService', () => ({
  AIService: {
    get extractJSON() {
      return extractJSON;
    },
  },
}));

import { SupportAgentService } from '../SupportAgentService';

const loadCtx = vi.fn();

beforeEach(() => {
  extractJSON.mockReset();
  vi.spyOn(SupportAgentService, 'loadAccountContext').mockImplementation(loadCtx as any);
  loadCtx.mockReset();
});

describe('SupportAgentService.resolve — answer', () => {
  it('answer con business_context → devuelve reply', async () => {
    loadCtx.mockResolvedValue({
      flows: [{ id: '1', name: 'Jub', trigger: 'jubilacion' }],
      config: { apiKey: 'sk', model: 'gpt-4o-mini', businessContext: 'Horario lun-vie 9-18.' },
    });
    extractJSON.mockResolvedValue({ action: 'answer', reply: 'Atendemos lun-vie 9-18hs 🙌' });
    const d = await SupportAgentService.resolve({ accountId: 'a', text: '¿horario?' });
    expect(d.action).toBe('answer');
    expect(d.reply).toContain('9-18');
  });

  it('answer sin business_context → forzar handoff (anti-alucinación)', async () => {
    loadCtx.mockResolvedValue({
      flows: [{ id: '1', name: 'Jub', trigger: 'jubilacion' }],
      config: { apiKey: 'sk', businessContext: '' },
    });
    extractJSON.mockResolvedValue({ action: 'answer', reply: 'invento algo' });
    const d = await SupportAgentService.resolve({ accountId: 'a', text: '¿precio?' });
    expect(d.action).toBe('handoff');
  });
});

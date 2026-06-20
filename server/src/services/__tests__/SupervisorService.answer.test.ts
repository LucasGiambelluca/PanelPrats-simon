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
import { SupervisorService } from '../SupervisorService';

beforeEach(() => {
  extractJSON.mockReset();
  vi.spyOn(SupportAgentService, 'loadAccountContext').mockResolvedValue({
    flows: [{ id: '1', name: 'Jub', trigger: 'jubilacion' }],
    config: { apiKey: 'sk', businessContext: 'Horario lun-vie 9-18.' },
  } as any);
});

describe('SupervisorService — answer', () => {
  it('answer con contexto → action answer + reply', async () => {
    extractJSON.mockResolvedValue({ action: 'answer', reply: 'Lun-vie 9-18hs 🙌' });
    const d = await SupervisorService.interpret({
      accountId: 'a', question: '¿Tu edad?', expectedOptions: [], userInput: '¿hasta qué hora atienden?',
    });
    expect(d.action).toBe('answer');
    expect(d.reply).toContain('9-18');
  });
});

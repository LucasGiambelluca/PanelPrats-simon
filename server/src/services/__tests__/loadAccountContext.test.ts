import { describe, it, expect, vi, beforeEach } from 'vitest';

const maybeSingle = vi.fn();
const flowsResult = { data: [] as any[] };

vi.mock('../../config/supabase', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'accounts') {
        return { select: () => ({ eq: () => ({ maybeSingle }) }) };
      }
      return { select: () => ({ eq: () => ({ eq: () => flowsResult }) }) };
    },
  },
}));

import { SupportAgentService } from '../SupportAgentService';

describe('loadAccountContext', () => {
  beforeEach(() => { maybeSingle.mockReset(); flowsResult.data = []; });

  it('expone business_context de la cuenta en config', async () => {
    maybeSingle.mockResolvedValue({
      data: {
        ai_support_enabled: true, ai_api_key: 'sk-x', ai_model: 'gpt-4o-mini',
        ai_support_prompt: 'rol', business_context: 'Horario: lun-vie 9-18.',
      },
    });
    const { config } = await SupportAgentService.loadAccountContext('acc-1');
    expect(config.businessContext).toBe('Horario: lun-vie 9-18.');
  });
});

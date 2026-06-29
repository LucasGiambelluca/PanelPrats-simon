import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../config/supabase', () => ({ supabase: {} }));

const extractJSON = vi.fn();
vi.mock('../AIService', () => ({ AIService: { get extractJSON() { return extractJSON; } } }));

import { SupportAgentService } from '../SupportAgentService';
import { SupervisorService } from '../SupervisorService';

beforeEach(() => {
  extractJSON.mockReset();
  vi.spyOn(SupportAgentService, 'loadAccountContext').mockResolvedValue({
    flows: [], config: { apiKey: 'sk' },
  } as any);
});

describe('SupervisorService — pre-pass OptionResolver (sin gastar IA)', () => {
  const opts = ['< 3 meses', '3-6 meses', '> 6 meses'];

  it('"el tercero" se mapea a la 3ra opción sin llamar a la IA', async () => {
    const d = await SupervisorService.interpret({
      accountId: 'a', question: '¿Hace cuánto?', expectedOptions: opts, userInput: 'el tercero',
    });
    expect(d.action).toBe('fill');
    expect(d.value).toBe('> 6 meses');
    expect(extractJSON).not.toHaveBeenCalled();
  });

  it('"la opción 1" se mapea a la 1ra sin IA', async () => {
    const d = await SupervisorService.interpret({
      accountId: 'a', question: '¿Hace cuánto?', expectedOptions: opts, userInput: 'la opción 1',
    });
    expect(d.value).toBe('< 3 meses');
    expect(extractJSON).not.toHaveBeenCalled();
  });

  it('texto libre ambiguo NO lo resuelve el pre-pass (cae a la IA)', async () => {
    extractJSON.mockResolvedValue({ action: 'fill', value: '3-6 meses' });
    const d = await SupervisorService.interpret({
      accountId: 'a', question: '¿Hace cuánto?', expectedOptions: opts, userInput: 'y... hace bastante, ni me acuerdo',
    });
    expect(extractJSON).toHaveBeenCalled();
    expect(d.action).toBe('fill');
  });
});

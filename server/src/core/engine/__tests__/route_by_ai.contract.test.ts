import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../services/SupportAgentService', () => ({
  SupportAgentService: { resolve: vi.fn() },
}));

import { SupportAgentService } from '../../../services/SupportAgentService';

beforeEach(() => vi.mocked(SupportAgentService.resolve).mockReset());

describe('route_by_ai usa SupportAgentService.resolve', () => {
  it('route → trigger del flujo', async () => {
    vi.mocked(SupportAgentService.resolve).mockResolvedValue({ action: 'route', trigger: 'jubilacion' });
    const d = await SupportAgentService.resolve({ accountId: 'a', text: 'me jubilo' });
    expect(d).toEqual({ action: 'route', trigger: 'jubilacion' });
  });
});

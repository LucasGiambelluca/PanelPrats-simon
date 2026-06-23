import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    upsert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { office_id: 'o1', profile_id: 'p1', activa: true }, error: null }) }) }),
  }) },
}));
import { officeProfessionalsRouter } from '../office-professionals.routes';

function getMw(router: any, method: string, path: string, idx: number) {
  const layer = router.stack.find((l: any) => l.route && l.route.methods[method] && l.route.path === path);
  return layer.route.stack[idx].handle;
}
function makeRes() {
  return { statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; } } as any;
}

describe('officeProfessionalsRouter POST validation', () => {
  it('rechaza profile_id no-uuid (validateBody 400)', () => {
    const validate = getMw(officeProfessionalsRouter(), 'post', '/:id/professionals', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ params: { id: 'o1' }, body: { profile_id: 'no-uuid' } }, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});

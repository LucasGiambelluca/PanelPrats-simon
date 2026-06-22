import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    insert: () => ({ select: () => ({ single: () => Promise.resolve({ data: { id: 'o1' }, error: null }) }) }),
  }) },
}));
import { officesRouter } from '../offices.routes';

function getMw(router: any, method: string, path: string, idx: number) {
  const layer = router.stack.find((l: any) => l.route && l.route.methods[method] && l.route.path === path);
  return layer.route.stack[idx].handle;
}
function makeRes() {
  return { statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; } } as any;
}

describe('officesRouter POST validation', () => {
  it('rechaza modalidad inválida (validateBody 400)', () => {
    const validate = getMw(officesRouter(), 'post', '/', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ body: { account_id: 'a', nombre: 'X', modalidad: 'otra', hora_inicio: '09:00', hora_fin: '18:00' } }, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('presencial sin dirección => 400 en el handler', async () => {
    const handler = (() => { const r: any = officesRouter(); const l = r.stack.find((x: any) => x.route?.methods.post && x.route.path === '/'); return l.route.stack[l.route.stack.length - 1].handle; })();
    const res = makeRes();
    await handler({ body: { account_id: 'a', nombre: 'CABA', modalidad: 'presencial', direccion: '', hora_inicio: '09:00', hora_fin: '18:00' } } as any, res);
    expect(res.statusCode).toBe(400);
  });
});

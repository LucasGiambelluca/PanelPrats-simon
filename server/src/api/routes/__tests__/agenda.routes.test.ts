import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: 'o1', account_id: 'acc1', nombre: 'CABA' }, error: null }) }), in: () => Promise.resolve({ data: [], error: null }) }),
  }) },
}));
const apptUpdate = vi.fn();
vi.mock('../../../services/AppointmentService', () => ({ AppointmentService: { list: () => Promise.resolve([]), update: (...a: any[]) => apptUpdate(...a) } }));

import { agendaRouter } from '../agenda.routes';

function handler(method: string, path: string) {
  const r: any = agendaRouter();
  const l = r.stack.find((x: any) => x.route?.methods[method] && x.route.path === path);
  return l.route.stack[l.route.stack.length - 1].handle;
}
function makeRes() {
  return { statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; } } as any;
}

describe('agendaRouter RBAC', () => {
  it('agenda oficina: 403 si no es admin', async () => {
    const res = makeRes();
    await handler('get', '/offices/:id')({ user: { role: 'empleada', id: 'p1' }, params: { id: 'o1' }, query: {} } as any, res);
    expect(res.statusCode).toBe(403);
  });

  it('agenda profesional: empleada ajena → 403', async () => {
    const res = makeRes();
    await handler('get', '/professionals/:id')({ user: { role: 'empleada', id: 'p1' }, params: { id: 'p2' }, query: { account_id: 'acc1', from: '2026-06-22T00:00:00Z', to: '2026-06-23T00:00:00Z' } } as any, res);
    expect(res.statusCode).toBe(403);
  });

  it('agenda profesional: empleada propia → 200', async () => {
    const res = makeRes();
    await handler('get', '/professionals/:id')({ user: { role: 'empleada', id: 'p1' }, params: { id: 'p1' }, query: { account_id: 'acc1', from: '2026-06-22T00:00:00Z', to: '2026-06-23T00:00:00Z' } } as any, res);
    expect(res.statusCode).toBe(200);
    expect(res.body.appointments).toEqual([]);
  });

  it('assign: profesional ocupado → 409', async () => {
    apptUpdate.mockRejectedValueOnce(new Error('PROFESSIONAL_BUSY'));
    const res = makeRes();
    await handler('patch', '/appointments/:id/assign')({ user: { role: 'admin' }, params: { id: 'a1' }, body: { profile_id: '11111111-1111-1111-1111-111111111111' } } as any, res);
    expect(res.statusCode).toBe(409);
  });
});

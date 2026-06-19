import { describe, it, expect, vi, beforeEach } from 'vitest';

const calls: { insert?: any } = {};
const adminUser = { id: 'new-uid', email: 'ana@bufete.com' };
vi.mock('../../../config/supabase', () => ({
  supabase: {
    auth: { admin: {
      createUser: (args: any) => { calls.insert = { ...calls.insert, createUser: args }; return Promise.resolve({ data: { user: adminUser }, error: null }); },
      listUsers: () => Promise.resolve({ data: { users: [adminUser] } }),
      updateUserById: () => Promise.resolve({ error: null }),
    } },
    from: () => ({
      insert: (row: any) => { calls.insert = { ...calls.insert, profileRow: row }; return Promise.resolve({ error: null }); },
      select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
    }),
  },
}));

import { teamRouter } from '../team.routes';

function getHandler(router: any, method: 'get' | 'post' | 'put', path: string) {
  const layer = router.stack.find((l: any) => l.route && l.route.methods[method] && l.route.path === path);
  return layer.route.stack[layer.route.stack.length - 1].handle;
}
function makeRes() {
  return { statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; } } as any;
}

describe('teamRouter POST /', () => {
  beforeEach(() => { calls.insert = undefined; });
  it('crea usuario y profile con rol empleada', async () => {
    const handler = getHandler(teamRouter(), 'post', '/');
    const res = makeRes();
    await handler({ body: { email: 'ana@bufete.com', password: 'secret123', name: 'Ana' } } as any, res);
    expect(calls.insert.createUser.email).toBe('ana@bufete.com');
    expect(calls.insert.profileRow.role).toBe('empleada');
    expect(calls.insert.profileRow.id).toBe('new-uid');
    expect(res.statusCode).toBe(200);
  });
  it('sin email/password => 400', async () => {
    const handler = getHandler(teamRouter(), 'post', '/');
    const res = makeRes();
    await handler({ body: { name: 'Ana' } } as any, res);
    expect(res.statusCode).toBe(400);
  });
});

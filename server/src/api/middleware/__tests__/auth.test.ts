import { describe, it, expect, vi, beforeEach } from 'vitest';

const state: { user: any; userError: any; profile: any } = { user: null, userError: null, profile: null };
vi.mock('../../../config/supabase', () => ({
  supabase: {
    auth: { getUser: () => Promise.resolve({ data: { user: state.user }, error: state.userError }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: state.profile }) }) }) }),
  },
}));

import { authContext, requireRole } from '../auth';

function makeReq(authHeader?: string) {
  return { header: (n: string) => (n === 'Authorization' ? authHeader : undefined), user: undefined } as any;
}
function makeRes() {
  return {
    statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; },
  } as any;
}

describe('authContext', () => {
  beforeEach(() => { state.user = null; state.userError = null; state.profile = null; delete process.env.DEV_AUTH_BYPASS; });

  it('sin token => 401', async () => {
    const res = makeRes(); let nexted = false;
    await authContext(makeReq(undefined), res, () => { nexted = true; });
    expect(res.statusCode).toBe(401); expect(nexted).toBe(false);
  });

  it('token válido + profile activo => req.user con rol', async () => {
    state.user = { id: 'u1' }; state.profile = { role: 'empleada', name: 'Ana', active: true };
    const req = makeReq('Bearer realtoken'); const res = makeRes(); let nexted = false;
    await authContext(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
    expect(req.user).toEqual({ id: 'u1', role: 'empleada', name: 'Ana', verTodasAgendas: false });
  });

  it('profile con ver_todas_agendas=true => req.user.verTodasAgendas true', async () => {
    state.user = { id: 'u1' }; state.profile = { role: 'empleada', name: 'Ana', active: true, ver_todas_agendas: true };
    const req = makeReq('Bearer realtoken'); const res = makeRes(); let nexted = false;
    await authContext(req, res, () => { nexted = true; });
    expect(nexted).toBe(true); expect(req.user.verTodasAgendas).toBe(true);
  });

  it('profile inactivo => 401', async () => {
    state.user = { id: 'u1' }; state.profile = { role: 'empleada', name: 'Ana', active: false };
    const res = makeRes(); let nexted = false;
    await authContext(makeReq('Bearer x'), res, () => { nexted = true; });
    expect(res.statusCode).toBe(401); expect(nexted).toBe(false);
  });

  it('profile con active null/ausente => 401', async () => {
    state.user = { id: 'u1' }; state.profile = { role: 'empleada', name: 'Ana', active: null };
    const res = makeRes(); let nexted = false;
    await authContext(makeReq('Bearer x'), res, () => { nexted = true; });
    expect(res.statusCode).toBe(401); expect(nexted).toBe(false);
  });

  it('dev-token con DEV_AUTH_BYPASS=1 => admin', async () => {
    process.env.DEV_AUTH_BYPASS = '1';
    const req = makeReq('Bearer dev-token'); const res = makeRes(); let nexted = false;
    await authContext(req, res, () => { nexted = true; });
    expect(nexted).toBe(true); expect(req.user.role).toBe('admin');
  });

  it('dev-token sin DEV_AUTH_BYPASS (ej. prod) => 401', async () => {
    // beforeEach borra DEV_AUTH_BYPASS: simula prod donde el bypass no está habilitado.
    const res = makeRes(); let nexted = false;
    await authContext(makeReq('Bearer dev-token'), res, () => { nexted = true; });
    expect(res.statusCode).toBe(401); expect(nexted).toBe(false);
  });
});

describe('requireRole', () => {
  it('rol correcto pasa', () => {
    const req = { user: { role: 'admin' } } as any; const res = makeRes(); let nexted = false;
    requireRole('admin')(req, res, () => { nexted = true; });
    expect(nexted).toBe(true);
  });
  it('rol incorrecto => 403', () => {
    const req = { user: { role: 'empleada' } } as any; const res = makeRes(); let nexted = false;
    requireRole('admin')(req, res, () => { nexted = true; });
    expect(res.statusCode).toBe(403); expect(nexted).toBe(false);
  });
});

import { describe, it, expect, vi } from 'vitest';
vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({
    select: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [], error: null }) }) }),
  }) },
}));
import { professionalsRouter } from '../professionals.routes';

function getMw(router: any, method: string, path: string, idx: number) {
  const layer = router.stack.find((l: any) => l.route && l.route.methods[method] && l.route.path === path);
  return layer.route.stack[idx].handle;
}
function makeRes() {
  return { statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; } } as any;
}

describe('professionalsRouter acceso GET / (listado)', () => {
  it('empleada con ver_todas_agendas puede listar → next()', () => {
    const guard = getMw(professionalsRouter(), 'get', '/', 0);
    const res = makeRes(); const next = vi.fn();
    guard({ user: { id: 'p1', role: 'empleada', verTodasAgendas: true } }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });

  it('empleada sin ver_todas_agendas → 403', () => {
    const guard = getMw(professionalsRouter(), 'get', '/', 0);
    const res = makeRes(); const next = vi.fn();
    guard({ user: { id: 'p1', role: 'empleada', verTodasAgendas: false } }, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it('admin puede listar → next()', () => {
    const guard = getMw(professionalsRouter(), 'get', '/', 0);
    const res = makeRes(); const next = vi.fn();
    guard({ user: { id: 'a1', role: 'admin', verTodasAgendas: false } }, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('resto del router exige admin (requireRole a nivel router)', () => {
    const router: any = professionalsRouter();
    // El r.use(requireRole('admin')) queda como layer sin route en el stack.
    const useLayer = router.stack.find((l: any) => !l.route && l.name !== 'router');
    expect(useLayer).toBeTruthy();
    const res = makeRes(); const next = vi.fn();
    useLayer.handle({ user: { id: 'p1', role: 'empleada', verTodasAgendas: true } }, res, next);
    expect(res.statusCode).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });
});

describe('professionalsRouter validation', () => {
  it('PUT availability rechaza ventana con hora_fin <= hora_inicio', () => {
    const validate = getMw(professionalsRouter(), 'put', '/:id/availability', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ params: { id: 'p1' }, query: { office_id: 'o1' },
      body: { ventanas: [{ dia: 1, hora_inicio: '18:00', hora_fin: '09:00' }] } }, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  it('PUT availability rechaza dia fuera de 0-6', () => {
    const validate = getMw(professionalsRouter(), 'put', '/:id/availability', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ params: { id: 'p1' }, query: { office_id: 'o1' },
      body: { ventanas: [{ dia: 9, hora_inicio: '09:00', hora_fin: '18:00' }] } }, res, next);
    expect(res.statusCode).toBe(400);
  });

  it('POST block rechaza end_time <= start_time', () => {
    const validate = getMw(professionalsRouter(), 'post', '/:id/blocks', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ params: { id: 'p1' },
      body: { start_time: '2026-07-01T15:00:00Z', end_time: '2026-07-01T14:00:00Z' } }, res, next);
    expect(res.statusCode).toBe(400);
  });

  it('POST block acepta rango válido sin office_id', () => {
    const validate = getMw(professionalsRouter(), 'post', '/:id/blocks', 0);
    const res = makeRes(); const next = vi.fn();
    validate({ params: { id: 'p1' },
      body: { start_time: '2026-07-01T14:00:00Z', end_time: '2026-07-01T16:00:00Z', motivo: 'vacaciones' } }, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBe(0);
  });
});

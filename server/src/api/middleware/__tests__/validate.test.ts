import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { validateBody } from '../validate';

const schema = z.object({
  email: z.string().email(),
  age: z.number().int().positive(),
}).strict();

function makeRes() {
  return {
    statusCode: 0, body: undefined as any,
    status(c: number) { this.statusCode = c; return this; },
    json(b: any) { this.body = b; if (!this.statusCode) this.statusCode = 200; return this; },
  } as any;
}

describe('validateBody', () => {
  it('body válido => next() y req.body parseado', () => {
    const req: any = { body: { email: 'a@b.com', age: 30 } };
    const res = makeRes();
    const next = vi.fn();
    validateBody(schema)(req, res, next);
    expect(next).toHaveBeenCalledOnce();
    expect(req.body).toEqual({ email: 'a@b.com', age: 30 });
  });

  it('body inválido => 400 con issues, sin next()', () => {
    const res = makeRes();
    const next = vi.fn();
    validateBody(schema)({ body: { email: 'no-es-email', age: -1 } } as any, res, next);
    expect(res.statusCode).toBe(400);
    expect(res.body.error).toBe('Datos inválidos');
    expect(Array.isArray(res.body.issues)).toBe(true);
    expect(next).not.toHaveBeenCalled();
  });

  it('descarta campos no declarados (.strict)', () => {
    const res = makeRes();
    const next = vi.fn();
    // campo extra => strict lo rechaza con 400
    validateBody(schema)({ body: { email: 'a@b.com', age: 30, hacker: 'x' } } as any, res, next);
    expect(res.statusCode).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });
});

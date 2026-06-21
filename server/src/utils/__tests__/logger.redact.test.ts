import { describe, it, expect } from 'vitest';
import { redactString, redactDeep } from '../logger';

describe('redactString', () => {
  it('redacta JWT (eyJ...)', () => {
    const jwt = 'eyJhbGciOiJI.eyJzdWIiOiIxMjM0.SflKxwRJSMeKKF2QT4';
    expect(redactString(`token=${jwt}`)).not.toContain(jwt);
    expect(redactString(`token=${jwt}`)).toContain('***REDACTED***');
  });
  it('redacta Bearer y claves OpenAI sk-', () => {
    expect(redactString('Authorization: Bearer abc.def-123')).toContain('Bearer ***REDACTED***');
    expect(redactString('key sk-proj-ABCDEFG1234567')).toContain('***REDACTED***');
  });
  it('deja texto normal intacto', () => {
    expect(redactString('hola mundo 42')).toBe('hola mundo 42');
  });
});

describe('redactDeep', () => {
  it('redacta valores de campos sensibles por nombre', () => {
    const out = redactDeep({ name: 'Ana', access_token: 'XYZ', nested: { app_secret: 'S', ok: 1 } });
    expect(out.name).toBe('Ana');
    expect(out.access_token).toBe('***REDACTED***');
    expect(out.nested.app_secret).toBe('***REDACTED***');
    expect(out.nested.ok).toBe(1);
  });
  it('redacta JWT embebido en strings dentro de objetos', () => {
    const out = redactDeep({ msg: 'Bearer eyJa.eyJb.cccc' });
    expect(out.msg).toContain('***REDACTED***');
  });
});

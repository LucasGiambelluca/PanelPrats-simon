import { describe, it, expect } from 'vitest';
import { PhoneUtils } from '../phoneUtils';

describe('PhoneUtils.normalize', () => {
  it('limpia sufijos y no-dígitos', () => {
    expect(PhoneUtils.normalize('+54 9 11 3334-4455@s.whatsapp.net')).toBe('541133344455');
  });
  it('unifica AR sacando el 9 móvil (549...13 → 54...12)', () => {
    expect(PhoneUtils.normalize('5491133344455')).toBe('541133344455');
  });
  it('conserva @lid tal cual', () => {
    expect(PhoneUtils.normalize('176295539376186@lid')).toBe('176295539376186@lid');
  });
});

describe('PhoneUtils.variants (matchear con-9 y sin-9 al consultar)', () => {
  it('AR sin 9 → incluye la forma con 9 (para historial guardado con 9)', () => {
    const v = PhoneUtils.variants('542915093499');
    expect(v).toContain('542915093499');
    expect(v).toContain('5492915093499');
  });
  it('AR con 9 → incluye ambas (normaliza + con 9)', () => {
    const v = PhoneUtils.variants('5492915093499');
    expect(new Set(v)).toEqual(new Set(['542915093499', '5492915093499']));
  });
  it('tolera prefijos/sufijos', () => {
    expect(PhoneUtils.variants('+54 9 11 3334-4455@s.whatsapp.net')).toEqual(
      expect.arrayContaining(['541133344455', '5491133344455']),
    );
  });
  it('@lid: sin variantes numéricas', () => {
    expect(PhoneUtils.variants('176295539376186@lid')).toEqual(['176295539376186@lid']);
  });
});

describe('PhoneUtils.resolveIdentity (@lid → teléfono real)', () => {
  it('chat normal: normaliza el remoteJid', () => {
    const map = new Map<string, string>();
    expect(PhoneUtils.resolveIdentity('542915093499@s.whatsapp.net', undefined, map)).toBe('542915093499');
  });

  it('@lid con senderPn: resuelve al real y APRENDE el mapeo', () => {
    const map = new Map<string, string>();
    const phone = PhoneUtils.resolveIdentity('176295539376186@lid', '5492915093499', map);
    expect(phone).toBe('542915093499'); // senderPn normalizado (9 móvil removido)
    expect(map.get('176295539376186')).toBe('542915093499');
  });

  it('@lid SIN senderPn pero con mapeo cacheado: resuelve al real (no se parte la convo)', () => {
    const map = new Map<string, string>([['176295539376186', '542915093499']]);
    expect(PhoneUtils.resolveIdentity('176295539376186@lid', undefined, map)).toBe('542915093499');
  });

  it('@lid SIN senderPn ni cache: cae al lid (fallback)', () => {
    const map = new Map<string, string>();
    expect(PhoneUtils.resolveIdentity('176295539376186@lid', undefined, map)).toBe('176295539376186@lid');
  });
});

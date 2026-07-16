import { describe, it, expect } from 'vitest';
import { esPsid } from '../psid';

// PSID/IGSID de FB/Instagram: identificador todo-dígitos largo. Nunca es un nombre.
describe('esPsid', () => {
  it('detecta PSID de Messenger/Instagram (15-17 dígitos)', () => {
    expect(esPsid('25516497748025583')).toBe(true);
    expect(esPsid('8961551790616003')).toBe(true);
  });
  it('un nombre real no es PSID', () => {
    expect(esPsid('Graciela')).toBe(false);
    expect(esPsid('María del Carmen')).toBe(false);
  });
  it('un teléfono AR de 10 dígitos no dispara (contexto nombre lo filtra igual por largo)', () => {
    expect(esPsid('3644363078')).toBe(false);
  });
  it('vacío/null-ish no es PSID', () => {
    expect(esPsid('')).toBe(false);
    expect(esPsid(undefined as any)).toBe(false);
    expect(esPsid(null as any)).toBe(false);
  });
});

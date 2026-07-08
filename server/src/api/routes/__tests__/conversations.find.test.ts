import { describe, it, expect } from 'vitest';
import { phoneSuffix, pickConversationForPhone } from '../conversations.routes';

const conv = (over: any) => ({
  id: 'c', account_id: 'a1', phone: '5493416403395', channel: 'whatsapp',
  contact_name: 'X', last_message: 'm', last_message_at: '2026-07-01T00:00:00Z',
  status: 'BOT', ...over,
});

describe('phoneSuffix', () => {
  it('normaliza formatos AR al sufijo de 10 dígitos', () => {
    expect(phoneSuffix('+54 9 341 640-3395')).toBe('3416403395');
    expect(phoneSuffix('5493416403395')).toBe('3416403395');
    expect(phoneSuffix('543416403395')).toBe('3416403395'); // sin el 9 móvil
    expect(phoneSuffix('341 640 3395')).toBe('3416403395'); // formato local
  });

  it('rechaza teléfonos con menos de 6 dígitos', () => {
    expect(phoneSuffix('123')).toBeNull();
    expect(phoneSuffix('')).toBeNull();
    expect(phoneSuffix('sin numero')).toBeNull();
  });
});

describe('pickConversationForPhone', () => {
  it('prefiere la conversación de la cuenta pedida aunque haya una más reciente en otra', () => {
    const rows = [
      conv({ id: 'c1', account_id: 'otra', last_message_at: '2026-07-07T00:00:00Z' }),
      conv({ id: 'c2', account_id: 'a1', last_message_at: '2026-07-01T00:00:00Z' }),
    ];
    expect(pickConversationForPhone(rows, 'a1')?.id).toBe('c2');
  });

  it('sin match de cuenta cae a la más reciente (primera fila)', () => {
    const rows = [
      conv({ id: 'c1', account_id: 'otra' }),
      conv({ id: 'c2', account_id: 'otra2' }),
    ];
    expect(pickConversationForPhone(rows, 'a1')?.id).toBe('c1');
  });

  it('sin account_id devuelve la más reciente', () => {
    const rows = [conv({ id: 'c1' }), conv({ id: 'c2' })];
    expect(pickConversationForPhone(rows, undefined)?.id).toBe('c1');
  });

  it('sin filas devuelve null', () => {
    expect(pickConversationForPhone([], 'a1')).toBeNull();
  });
});

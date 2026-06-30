import { describe, it, expect, vi, beforeEach } from 'vitest';

const rows: any[] = [];
vi.mock('../../config/supabase', () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({
            order: () => Promise.resolve({ data: rows, error: null }),
          }),
        }),
      }),
    }),
  },
}));

import { MessageStore } from '../MessageStore';

describe('MessageStore.getTranscript', () => {
  beforeEach(() => { rows.length = 0; });

  it('arma el transcript Cliente/Asistente en orden', async () => {
    rows.push(
      { direction: 'INBOUND', content: 'hola, quiero jubilarme', timestamp: '2026-06-01T10:00:00Z' },
      { direction: 'OUTBOUND', content: '¡Hola! ¿De qué zona sos?', timestamp: '2026-06-01T10:01:00Z' },
      { direction: 'INBOUND', content: 'soy de Lanús', timestamp: '2026-06-01T10:02:00Z' },
    );
    const t = await new MessageStore().getTranscript('acc1', '549111');
    expect(t).toBe('Cliente: hola, quiero jubilarme\nAsistente: ¡Hola! ¿De qué zona sos?\nCliente: soy de Lanús');
  });

  it('devuelve "" si no hay mensajes', async () => {
    const t = await new MessageStore().getTranscript('acc1', 'nadie');
    expect(t).toBe('');
  });
});

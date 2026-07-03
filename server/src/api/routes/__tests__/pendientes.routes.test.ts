import { describe, it, expect } from 'vitest';
import { armarPendientes } from '../pendientes.routes';
import type { ConversationRow, ContactMemoryRow } from '../../../core/callsheet/PendienteEvaluator';

const conv = (over: Partial<ConversationRow>): ConversationRow => ({
  id: 'c', account_id: 'a1', phone: '5492215093499', channel: 'whatsapp',
  contact_name: 'X', last_message: 'm', last_message_at: '2026-07-01T00:00:00Z',
  status: 'BOT', closed_at: null, close_reason: null, ...over,
});

describe('armarPendientes', () => {
  it('excluye con cita, opt_out y FB/IG sin teléfono; dedup por teléfono', () => {
    const conversations: ConversationRow[] = [
      conv({ id: 'c1', phone: '5492215093499' }),                       // entra
      conv({ id: 'c2', phone: '5492215093499' }),                       // dup del mismo teléfono → 1 sola
      conv({ id: 'c3', phone: '5491133334444' }),                       // tiene cita → fuera
      conv({ id: 'c4', phone: '5492944000111' }),                       // opt_out → fuera
      conv({ id: 'c5', channel: 'facebook', phone: '2799887766' }),     // FB sin teléfono → fuera
    ];
    const contacts = new Map<string, ContactMemoryRow>([
      ['c4', { opt_out: true } as any],
    ]);
    const appointments = [{ phone: '5491133334444', telefono: null }];
    const filas = armarPendientes(conversations, contacts, appointments);
    const tels = filas.map((f) => f.telefono);
    expect(filas.length).toBe(1);
    expect(tels).toContain('542215093499');
  });
});

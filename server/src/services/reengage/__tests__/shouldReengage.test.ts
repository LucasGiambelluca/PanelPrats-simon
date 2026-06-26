import { describe, it, expect } from 'vitest';
import { shouldReengage, horaLocal, esNoche, esManana } from '../shouldReengage';

// Helper: ISO de una fecha/hora local AR (UTC-3) → instante UTC.
const arLocal = (y: number, mo: number, d: number, h: number, mi = 0) =>
  new Date(Date.UTC(y, mo - 1, d, h + 3, mi)); // AR = UTC-3

describe('helpers de hora local AR', () => {
  it('horaLocal interpreta UTC-3', () => {
    expect(horaLocal(arLocal(2026, 7, 1, 23))).toBe(23);
    expect(horaLocal(arLocal(2026, 7, 1, 2))).toBe(2);
  });
  it('esNoche cubre 22..08', () => {
    expect(esNoche(22)).toBe(true);
    expect(esNoche(2)).toBe(true);
    expect(esNoche(7)).toBe(true);
    expect(esNoche(8)).toBe(false);
    expect(esNoche(15)).toBe(false);
  });
  it('esManana cubre 09..21', () => {
    expect(esManana(9)).toBe(true);
    expect(esManana(8)).toBe(false);
    expect(esManana(22)).toBe(false);
  });
});

describe('shouldReengage', () => {
  const base = {
    lastMessageAt: arLocal(2026, 7, 1, 23),   // anoche 23:00
    reengagedFor: null as Date | null,
    lastInboundAt: arLocal(2026, 7, 1, 23),    // inbound anoche → dentro de 24h a la mañana
    status: 'BOT',
    now: arLocal(2026, 7, 2, 9, 30),           // hoy 09:30
  };

  it('charla cortada de noche → re-engancha a la mañana', () => {
    expect(shouldReengage(base)).toBe(true);
  });
  it('de madrugada NO (now no es mañana)', () => {
    expect(shouldReengage({ ...base, now: arLocal(2026, 7, 2, 3) })).toBe(false);
  });
  it('último mensaje de día (no de noche) → NO', () => {
    expect(shouldReengage({ ...base, lastMessageAt: arLocal(2026, 7, 1, 15) })).toBe(false);
  });
  it('ya re-enganchado para ese last_message_at → NO', () => {
    expect(shouldReengage({ ...base, reengagedFor: base.lastMessageAt })).toBe(false);
  });
  it('fuera de la ventana 24h (inbound viejo) → NO', () => {
    expect(shouldReengage({ ...base, lastInboundAt: arLocal(2026, 6, 30, 23) })).toBe(false);
  });
  it('sin inbound nunca → NO', () => {
    expect(shouldReengage({ ...base, lastInboundAt: null })).toBe(false);
  });
  it('conversación en HANDOVER → NO', () => {
    expect(shouldReengage({ ...base, status: 'HANDOVER' })).toBe(false);
  });
});

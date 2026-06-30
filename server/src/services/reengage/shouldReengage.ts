const TZ = 'America/Argentina/Buenos_Aires';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Hora local (0-23) en la zona del estudio para ese instante. */
export function horaLocal(date: Date): number {
  const hh = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: '2-digit', hour12: false }).format(date);
  const h = Number(hh);
  return h === 24 ? 0 : h;
}

/** Noche: 22:00–07:59 local. */
export function esNoche(hora: number): boolean {
  return hora >= 22 || hora < 8;
}

/** Mañana/día hábil de contacto: 09:00–21:59 local. */
export function esManana(hora: number): boolean {
  return hora >= 9 && hora < 22;
}

const CLOSED_FOR_GOOD = new Set(['opt_out', 'despedida', 'frustracion_handoff']);

export interface ReengageInput {
  lastMessageAt: Date;
  reengagedFor: Date | null;
  lastInboundAt: Date | null;
  status: string;
  now: Date;
  /** Compliance: no re-enganchar a contactos que pidieron opt-out. */
  optOut?: boolean;
  /** Compliance: no re-enganchar si la conversación se cerró por estos motivos. */
  closeReason?: string | null;
}

/** ¿Hay que re-enganchar esta conversación ahora? Pura, sin efectos. */
export function shouldReengage(i: ReengageInput): boolean {
  // ── Compliance PRIMERO ──────────────────────────────────────────────────────
  if (i.optOut === true) return false;                                    // pidió no ser contactado
  if (i.closeReason && CLOSED_FOR_GOOD.has(i.closeReason)) return false; // cierre definitivo
  // ── Lógica de ventana (intacta) ─────────────────────────────────────────────
  if (i.status !== 'BOT') return false;                                   // humano la maneja
  if (!esNoche(horaLocal(i.lastMessageAt))) return false;                 // se cortó de noche
  if (!esManana(horaLocal(i.now))) return false;                          // ahora es de mañana
  if (i.reengagedFor && i.reengagedFor.getTime() === i.lastMessageAt.getTime()) return false; // idempotente
  if (!i.lastInboundAt) return false;                                     // nunca escribió → sin ventana
  if (i.now.getTime() - i.lastInboundAt.getTime() > DAY_MS) return false; // fuera de 24h
  return true;
}

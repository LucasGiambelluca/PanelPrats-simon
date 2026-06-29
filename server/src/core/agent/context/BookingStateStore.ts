// Estado del BookingFlow en Redis (efímero, por sesión). Permite que el state
// machine determinístico sobreviva entre mensajes sin tocar la DB.

import { redisPersistence } from '../../../infrastructure/persistence/RedisPersistenceService';
import type { BookingState } from './BookingFlow';

const TTL = 60 * 30; // 30 min para completar una reserva.
const key = (accountId: string, phone: string) => `booking:${accountId}:${phone}`;

export class BookingStateStore {
  async get(accountId: string, phone: string): Promise<BookingState | null> {
    try {
      const raw = await redisPersistence.getRaw(key(accountId, phone));
      return raw ? (JSON.parse(raw) as BookingState) : null;
    } catch { return null; }
  }
  async set(accountId: string, phone: string, state: BookingState): Promise<void> {
    try { await redisPersistence.setRaw(key(accountId, phone), JSON.stringify(state), TTL); } catch { /* best-effort */ }
  }
  async clear(accountId: string, phone: string): Promise<void> {
    try { await redisPersistence.setRaw(key(accountId, phone), '', 1); } catch { /* best-effort */ }
  }
}

// Persistencia de las opciones que el agente YA ofreció (para Capacidad 4).
// Vive en Redis (estado de sesión, efímero): el OptionResolver necesita saber qué
// se presentó y en qué orden para entender "el tercero" / "el de videollamada".

import { redisPersistence } from '../../../infrastructure/persistence/RedisPersistenceService';
import type { OfferedOption } from './OptionResolver';

const TTL = 60 * 30; // 30 min: ventana razonable para que el usuario elija.
const key = (accountId: string, phone: string) => `offered:${accountId}:${phone}`;

export class OfferedOptionsStore {
  async set(accountId: string, phone: string, options: OfferedOption[]): Promise<void> {
    try { await redisPersistence.setRaw(key(accountId, phone), JSON.stringify(options ?? []), TTL); }
    catch { /* best-effort: si Redis no está, el agente sigue sin atajo */ }
  }

  async get(accountId: string, phone: string): Promise<OfferedOption[]> {
    try {
      const raw = await redisPersistence.getRaw(key(accountId, phone));
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch { return []; }
  }
}

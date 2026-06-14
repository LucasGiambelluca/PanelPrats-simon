/**
 * RedisPersistenceService — PLACEHOLDER MÍNIMO (Plan 2, Task 6).
 *
 * Este archivo existe sólo para que `BufferMemoryExecutor` (que importa
 * `redisPersistence`) compile. Las implementaciones son no-ops/defaults.
 *
 * Task 7 del Plan 2 lo REEMPLAZA por la versión real portada desde StockSystem
 * con namespacing por `accountId` (firmas `(accountId, phone, ...)` usando
 * `checkpointKey(accountId, phone)` y TTL de 1800s). NO construir sobre este
 * placeholder: será sobrescrito.
 */
export class RedisPersistenceService {
    async setCheckpoint(phone: string, checkpoint: any): Promise<void> {
        // no-op placeholder
    }

    async getCheckpoint(phone: string): Promise<any | null> {
        return null;
    }

    async getHistory(phone: string, limit: number = 10): Promise<any[]> {
        return [];
    }

    async deleteCheckpoint(phone: string): Promise<void> {
        // no-op placeholder
    }
}

export const redisPersistence = new RedisPersistenceService();

import { redis } from '../../config/redis';
import { supabase } from '../../config/database';
import { PhoneUtils } from '../../utils/phoneUtils';
import { logger } from '../../utils/logger';
import { checkpointKey } from '../../lib/account-keys';

/**
 * RedisPersistenceService — checkpoints de sesión + historial conversacional.
 *
 * Portado desde StockSystem (Plan 2, Task 7). Reemplaza el placeholder de Task 6.
 *
 * Aislamiento por cuenta: todos los métodos de checkpoint reciben `accountId`
 * como PRIMER parámetro y namespacian la clave Redis vía `checkpointKey`.
 * `getHistory` también recibe `accountId` para filtrar el historial por cuenta.
 *
 * Usa el cliente Redis compartido (`../../config/redis`, ioredis) en lugar de
 * instanciar su propio cliente.
 */
class RedisPersistenceService {
    private readonly TTL = 1800; // 30 minutes in seconds

    async setRaw(key: string, value: string, ttl: number = this.TTL): Promise<void> {
        try {
            await redis.set(key, value, 'EX', ttl);
        } catch (e: any) {
            logger.error(`[Redis] setRaw error: ${e.message}`);
        }
    }

    async getRaw(key: string): Promise<string | null> {
        try {
            return await redis.get(key);
        } catch (e: any) {
            logger.error(`[Redis] getRaw error: ${e.message}`);
            return null;
        }
    }

    async setCheckpoint(accountId: string, phone: string, checkpoint: any): Promise<void> {
        const key = checkpointKey(accountId, phone);
        await this.setRaw(key, JSON.stringify({
            ...checkpoint,
            updatedAt: Date.now()
        }));
        logger.debug(`[Redis] Checkpoint saved for ${accountId}:${phone}`);
    }

    async getCheckpoint(accountId: string, phone: string): Promise<any | null> {
        const key = checkpointKey(accountId, phone);
        const data = await this.getRaw(key);
        return data ? JSON.parse(data) : null;
    }

    async deleteCheckpoint(accountId: string, phone: string): Promise<void> {
        try {
            await redis.del(checkpointKey(accountId, phone));
        } catch (e: any) {
            logger.error(`[Redis] deleteCheckpoint error: ${e.message}`);
        }
    }

    async getHistory(accountId: string, phone: string, limit: number = 10): Promise<any[]> {
        try {
            // `.in(variants)` matchea el teléfono se haya guardado con o sin el 9 móvil
            // (distintos clientes guardan distinto). Con `.eq(normalize)` el historial
            // quedaba vacío y el agente "no tenía memoria".
            const { data } = await supabase
                .from('whatsapp_messages')
                .select('content, direction, created_at')
                .eq('account_id', accountId)
                .in('phone', PhoneUtils.variants(phone))
                .order('created_at', { ascending: false })
                .limit(limit);

            return (data || []).reverse().map((m: any) => ({
                role: m.direction === 'OUTBOUND' ? 'assistant' : 'user',
                content: m.content
            }));
        } catch (e: any) {
            logger.error(`[RedisPersistence] getHistory failed: ${e.message}`);
            return [];
        }
    }

    public isReady(): boolean {
        return redis.status === 'ready';
    }
}

export const redisPersistence = new RedisPersistenceService();

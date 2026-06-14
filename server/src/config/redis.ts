import Redis from 'ioredis';
import 'dotenv/config';

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

export const redis = new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  enableReadyCheck: false,
  enableOfflineQueue: false,
  retryStrategy(times: number): number | null {
    if (times > 3) return null;
    return Math.min(times * 100, 2000);
  },
});

redis.on('error', (err: Error) => console.error('❌ [redis]', err.message));
redis.on('connect', () => console.log('✅ [redis] conectado'));

/** Cierre limpio para tests/shutdown. */
export async function closeRedis(): Promise<void> {
  await redis.quit();
}

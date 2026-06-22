import 'dotenv/config';

// Zona horaria del proceso: toda la agenda (slots, horarios laborales, recordatorios)
// se calcula con new Date()/setHours/getHours en hora LOCAL. En un server cloud (UTC)
// eso corre las citas varias horas. Fijamos Argentina por defecto para que coincida
// con el formateo de recordatorios. En el deploy conviene además setear TZ como env.
process.env.TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';

import { FlowEngine } from './core/engine/flow.engine';
import { AccountManager } from './core/accounts/AccountManager';
import { ReminderScheduler } from './services/ReminderScheduler';
import { WebhookQueue } from './services/WebhookQueue';
import { setNotificationSender } from './services/NotifierService';
import { createApp } from './api/app';
import { closeRedis } from './config/redis';
import { initErrorTracking, captureException } from './config/errorTracking';

// Error tracking (A9): Sentry si hay SENTRY_DSN, no-op si no.
initErrorTracking();

// Red de seguridad: un error no atrapado (en un flujo, un webhook, una librería)
// NO debe tumbar todo el servidor de bots. Lo logueamos, lo reportamos y seguimos vivos.
process.on('unhandledRejection', (reason: any) => {
  console.error('⚠️ [unhandledRejection]', reason?.stack || reason);
  captureException(reason);
});
process.on('uncaughtException', (err: any) => {
  console.error('⚠️ [uncaughtException]', err?.stack || err);
  captureException(err);
});

async function bootstrap() {
  const PORT = Number(process.env.PORT || 3001);

  // Guard de seguridad: el bypass de auth NUNCA debe convivir con producción.
  // Fail-fast antes de aceptar tráfico si alguien dejó DEV_AUTH_BYPASS=1 en prod.
  if (process.env.NODE_ENV === 'production' && process.env.DEV_AUTH_BYPASS === '1') {
    console.error('❌ SEGURIDAD: DEV_AUTH_BYPASS=1 con NODE_ENV=production. Abortando. Quitá el flag del entorno de prod.');
    process.exit(1);
  }

  const engine = new FlowEngine();
  const manager = new AccountManager(engine);

  // Permite que executors (ej agendamiento) notifiquen por la línea de una cuenta.
  setNotificationSender(async (accountId, to, text) => { await manager.sendMessage(accountId, to, text); });

  // Cola durable de webhooks: el request encola y devuelve 200 rápido; el worker
  // procesa en background con retry/backoff + dead-letter (A1, no perder eventos).
  const webhookQueue = new WebhookQueue(manager);
  webhookQueue.start();

  const app = createApp(manager, webhookQueue);
  const server = app.listen(PORT, '0.0.0.0', () => console.log(`🚀 server en :${PORT}`));

  // Recordatorios de citas (20 min antes, dentro de la ventana de 24h).
  const reminders = new ReminderScheduler(manager);

  // Apagado limpio (A7): al recibir SIGTERM/SIGINT dejamos de aceptar requests,
  // frenamos los workers, cerramos los clientes de WhatsApp y la conexión Redis.
  // Con timeout de respaldo por si algo se cuelga. Se registra ANTES de
  // bootstrapExisting (que puede tardar varios segundos reconectando): así una
  // señal recibida durante el arranque no se pierde.
  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`🛑 ${signal} recibido: apagando limpio…`);
    const forced = setTimeout(() => { console.error('⏱️ apagado forzado (timeout)'); process.exit(1); }, 10_000);
    try {
      await new Promise<void>((resolve) => server.close(() => resolve())); // no más requests nuevos
      reminders.stop();
      webhookQueue.stop();
      await manager.stopAll();
      await closeRedis();
      clearTimeout(forced);
      console.log('✅ apagado completo');
      process.exit(0);
    } catch (e: any) {
      console.error('❌ error en apagado:', e?.message ?? e);
      process.exit(1);
    }
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Reconectar cuentas que estaban conectadas
  await manager.bootstrapExisting().catch((e) => console.error('[bootstrap] reconexión:', e));

  reminders.start();
}

bootstrap().catch((e) => {
  console.error('❌ bootstrap falló:', e);
  process.exit(1);
});

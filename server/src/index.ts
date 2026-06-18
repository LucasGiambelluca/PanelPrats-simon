import 'dotenv/config';
import { FlowEngine } from './core/engine/flow.engine';
import { AccountManager } from './core/accounts/AccountManager';
import { ReminderScheduler } from './services/ReminderScheduler';
import { setNotificationSender } from './services/NotifierService';
import { createApp } from './api/app';

// Red de seguridad: un error no atrapado (en un flujo, un webhook, una librería)
// NO debe tumbar todo el servidor de bots. Lo logueamos y seguimos vivos.
process.on('unhandledRejection', (reason: any) => {
  console.error('⚠️ [unhandledRejection]', reason?.stack || reason);
});
process.on('uncaughtException', (err: any) => {
  console.error('⚠️ [uncaughtException]', err?.stack || err);
});

async function bootstrap() {
  const PORT = Number(process.env.PORT || 3001);

  const engine = new FlowEngine();
  const manager = new AccountManager(engine);

  // Permite que executors (ej agendamiento) notifiquen por la línea de una cuenta.
  setNotificationSender((accountId, to, text) => manager.sendMessage(accountId, to, text));

  const app = createApp(manager);
  app.listen(PORT, '0.0.0.0', () => console.log(`🚀 server en :${PORT}`));

  // Reconectar cuentas que estaban conectadas
  await manager.bootstrapExisting().catch((e) => console.error('[bootstrap] reconexión:', e));

  // Recordatorios de citas (20 min antes, dentro de la ventana de 24h)
  new ReminderScheduler(manager).start();
}

bootstrap().catch((e) => {
  console.error('❌ bootstrap falló:', e);
  process.exit(1);
});

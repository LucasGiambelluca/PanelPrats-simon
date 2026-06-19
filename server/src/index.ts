import 'dotenv/config';

// Zona horaria del proceso: toda la agenda (slots, horarios laborales, recordatorios)
// se calcula con new Date()/setHours/getHours en hora LOCAL. En un server cloud (UTC)
// eso corre las citas varias horas. Fijamos Argentina por defecto para que coincida
// con el formateo de recordatorios. En el deploy conviene además setear TZ como env.
process.env.TZ = process.env.TZ || 'America/Argentina/Buenos_Aires';

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
  setNotificationSender(async (accountId, to, text) => { await manager.sendMessage(accountId, to, text); });

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

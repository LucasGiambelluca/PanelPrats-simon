import 'dotenv/config';
import { FlowEngine } from './core/engine/flow.engine';
import { AccountManager } from './core/accounts/AccountManager';
import { createApp } from './api/app';

async function bootstrap() {
  const PORT = Number(process.env.PORT || 3001);

  const engine = new FlowEngine();
  const manager = new AccountManager(engine);

  const app = createApp(manager);
  app.listen(PORT, '0.0.0.0', () => console.log(`🚀 server en :${PORT}`));

  // Reconectar cuentas que estaban conectadas
  await manager.bootstrapExisting().catch((e) => console.error('[bootstrap] reconexión:', e));
}

bootstrap().catch((e) => {
  console.error('❌ bootstrap falló:', e);
  process.exit(1);
});

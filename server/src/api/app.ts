import express from 'express';
import cors from 'cors';
import type { AccountManager } from '../core/accounts/AccountManager';
import { accountsRouter } from './routes/accounts.routes';
import { flowsRouter } from './routes/flows.routes';
import { conversationsRouter } from './routes/conversations.routes';
import { messagesRouter } from './routes/messages.routes';
import { configRouter } from './routes/config.routes';
import { appointmentsRouter } from './routes/appointments.routes';
import { callsRouter } from './routes/calls.routes';
import { metaWebhookRouter } from './routes/webhooks.routes';

export function createApp(manager: AccountManager) {
  const app = express();
  app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',') }));
  // Capturamos el raw body para verificar la firma del webhook de Meta (HMAC-SHA256).
  app.use(express.json({
    limit: '5mb',
    verify: (req, _res, buf) => { (req as any).rawBody = buf; },
  }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/accounts', accountsRouter(manager));
  app.use('/api/flows', flowsRouter());
  app.use('/api/conversations', conversationsRouter());
  app.use('/api/messages', messagesRouter(manager));
  app.use('/api/config', configRouter());
  app.use('/api/appointments', appointmentsRouter());
  app.use('/api/calls', callsRouter());
  app.use('/api/webhooks/meta', metaWebhookRouter(manager));

  return app;
}

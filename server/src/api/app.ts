import express from 'express';
import cors from 'cors';
import type { AccountManager } from '../core/accounts/AccountManager';
import { accountsRouter } from './routes/accounts.routes';
import { flowsRouter } from './routes/flows.routes';
import { conversationsRouter } from './routes/conversations.routes';
import { messagesRouter } from './routes/messages.routes';

export function createApp(manager: AccountManager) {
  const app = express();
  app.use(cors({ origin: (process.env.CORS_ORIGIN || '*').split(',') }));
  app.use(express.json({ limit: '5mb' }));

  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/accounts', accountsRouter(manager));
  app.use('/api/flows', flowsRouter());
  app.use('/api/conversations', conversationsRouter());
  app.use('/api/messages', messagesRouter(manager));

  return app;
}

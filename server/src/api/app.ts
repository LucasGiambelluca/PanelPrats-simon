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
import { salasRouter, salasPublicRouter } from './routes/salas.routes';
import { metaWebhookRouter } from './routes/webhooks.routes';
import { meRouter } from './routes/me.routes';
import { teamRouter } from './routes/team.routes';
import { authContext, requireRole } from './middleware/auth';

export function createApp(manager: AccountManager) {
  const app = express();
  // CORS: en producción exigir CORS_ORIGIN explícito (no permitir '*'). Si falta,
  // se bloquea el cross-origin (el panel servido en el mismo dominio sigue andando).
  const corsOrigin = process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(',')
    : (process.env.NODE_ENV === 'production' ? false : '*');
  if (process.env.NODE_ENV === 'production' && !process.env.CORS_ORIGIN) {
    console.warn('[CORS] producción sin CORS_ORIGIN: se bloquea el cross-origin. Seteá CORS_ORIGIN.');
  }
  app.use(cors({ origin: corsOrigin }));
  // Capturamos el raw body para verificar la firma del webhook de Meta (HMAC-SHA256).
  app.use(express.json({
    limit: '5mb',
    verify: (req, _res, buf) => { (req as any).rawBody = buf; },
  }));

  // Público: health + webhook de Meta (firma HMAC) + entrar a una sala como invitado
  // (la seguridad la da el invite-token opaco, no el JWT).
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/webhooks/meta', metaWebhookRouter(manager));
  app.use('/api/salas', salasPublicRouter());

  // Protegido: requiere JWT válido (authContext). Tier operativo (admin + empleada):
  app.use('/api/me', authContext, meRouter());
  app.use('/api/accounts', authContext, accountsRouter(manager));      // GET ambos; mutaciones admin (en el router)
  app.use('/api/conversations', authContext, conversationsRouter());
  app.use('/api/messages', authContext, messagesRouter(manager));
  app.use('/api/appointments', authContext, appointmentsRouter());
  app.use('/api/calls', authContext, callsRouter());
  app.use('/api/salas', authContext, salasRouter());

  // Solo admin:
  app.use('/api/flows', authContext, requireRole('admin'), flowsRouter());
  app.use('/api/config', authContext, requireRole('admin'), configRouter());
  app.use('/api/team', authContext, requireRole('admin'), teamRouter());

  return app;
}

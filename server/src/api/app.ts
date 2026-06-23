import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
import { officesRouter } from './routes/offices.routes';
import { officeProfessionalsRouter } from './routes/office-professionals.routes';
import { authContext, requireRole } from './middleware/auth';
import type { WebhookQueue } from '../services/WebhookQueue';

export function createApp(manager: AccountManager, webhookQueue?: WebhookQueue) {
  const app = express();
  // Detrás de un reverse proxy (Render/Nginx) confiamos en el primer X-Forwarded-For
  // para que el rate limiting use la IP real del cliente, no la del proxy.
  app.set('trust proxy', 1);
  // Cabeceras de seguridad (CSP, HSTS, X-Frame-Options, etc.).
  app.use(helmet());
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

  // Límite general por IP para la API protegida. El webhook de Meta queda EXCLUItdo
  // (Meta envía ráfagas legítimas y ya valida firma HMAC). Limiter estricto para
  // endpoints sensibles (alta de usuarios, mutación de config).
  const apiLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 300, standardHeaders: true, legacyHeaders: false });
  const sensitiveLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });

  // Público: health + webhook de Meta (firma HMAC) + entrar a una sala como invitado
  // (la seguridad la da el invite-token opaco, no el JWT). NO rate-limited.
  app.get('/health', (_req, res) => res.json({ ok: true }));
  app.use('/api/webhooks/meta', metaWebhookRouter(manager, webhookQueue));
  app.use('/api/salas', salasPublicRouter());

  // A partir de acá, todo pasa por el rate limiter general.
  app.use('/api', apiLimiter);

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
  app.use('/api/config', authContext, requireRole('admin'), sensitiveLimiter, configRouter());
  app.use('/api/team', authContext, requireRole('admin'), sensitiveLimiter, teamRouter());
  app.use('/api/offices', authContext, requireRole('admin'), officesRouter());
  app.use('/api/offices', authContext, requireRole('admin'), officeProfessionalsRouter());

  return app;
}

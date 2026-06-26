import { Router } from 'express';
import { AIService } from '../../services/AIService';
import { SupabaseBrainDb } from '../../core/agent/config/SupabaseBrainDb';
import { getBrainState } from '../../core/agent/config/getBrainState';
import { applyChanges } from '../../core/agent/config/applyChanges';
import { ConfigAgent } from '../../core/agent/config/ConfigAgent';
import { ConfigToolRegistry } from '../../core/agent/config/ConfigToolRegistry';
import type { Change } from '../../core/agent/config/types';

/**
 * Apartado "Agente": cerebro editable + config-agent. Solo admin: se monta detrás
 * de requireRole('admin') en app.ts. El config-agent PROPONE (POST /chat); recién
 * POST /apply escribe, fan-out a todas las cuentas del estudio.
 */
export function agenteRouter(): Router {
  const r = Router();
  const db = new SupabaseBrainDb();
  const agent = new ConfigAgent({ ai: { completeWithTools: (o) => AIService.completeWithTools(o) }, registry: new ConfigToolRegistry() });

  r.get('/state', async (_req, res) => {
    try { res.json(await getBrainState(db)); }
    catch (e: any) { res.status(500).json({ error: e?.message ?? 'error' }); }
  });

  r.post('/chat', async (req, res) => {
    try {
      const messages = Array.isArray(req.body?.messages) ? req.body.messages : [];
      const state = await getBrainState(db);
      res.json(await agent.handle(messages, state));
    } catch (e: any) { res.status(500).json({ error: e?.message ?? 'error' }); }
  });

  r.post('/apply', async (req, res) => {
    try {
      const changes = (Array.isArray(req.body?.changes) ? req.body.changes : []) as Change[];
      const results = await applyChanges(changes, db);
      res.json({ applied: results.filter((x) => x.ok).length, results });
    } catch (e: any) { res.status(500).json({ error: e?.message ?? 'error' }); }
  });

  return r;
}

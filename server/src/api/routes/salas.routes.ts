import { Router } from 'express';
import { SalaService } from '../../services/SalaService';

export function salasRouter(): Router {
  const r = Router();

  const guard = (res: any) => {
    if (!SalaService.isConfigured()) {
      res.status(503).json({ status: 'not_configured', message: 'Daily no configurado: falta DAILY_API_KEY.' });
      return false;
    }
    return true;
  };

  // Crear sala (operador)
  r.post('/', async (req, res) => {
    if (!guard(res)) return;
    try {
      const { account_id, appointment_id, titulo, created_by } = req.body || {};
      const sala = await SalaService.createSala({ accountId: account_id, appointmentId: appointment_id, titulo, createdBy: created_by });
      res.json(sala);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Generar enlace de invitado
  r.post('/:salaId/invitar', async (req, res) => {
    if (!guard(res)) return;
    try {
      const { nombre } = req.body || {};
      if (!nombre || !String(nombre).trim()) return res.status(400).json({ error: 'Falta el nombre del invitado' });
      const out = await SalaService.invitar(req.params.salaId, String(nombre).trim());
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  // Token de operador (owner)
  r.post('/:salaId/host-token', async (req, res) => {
    if (!guard(res)) return;
    try {
      const out = await SalaService.hostToken(req.params.salaId, req.body?.nombre);
      res.json(out);
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  return r;
}

// Router PÚBLICO de salas (sin JWT): el invitado entra sin login. La seguridad la da
// el invite-token opaco (hash en DB) + la ventana de validez. Se monta ANTES de authContext.
export function salasPublicRouter(): Router {
  const r = Router();
  r.post('/join', async (req, res) => {
    if (!SalaService.isConfigured()) {
      return res.status(503).json({ status: 'not_configured', message: 'Salas no configuradas.' });
    }
    const { salaId, invite } = req.body || {};
    if (!salaId || !invite) return res.status(400).json({ error: 'Faltan datos' });
    try {
      const out = await SalaService.join(String(salaId), String(invite));
      res.json(out);
    } catch (e: any) {
      const code = e.message === 'EXPIRED' ? 410 : e.message === 'INVALID' ? 403 : 400;
      res.status(code).json({ error: e.message });
    }
  });
  return r;
}

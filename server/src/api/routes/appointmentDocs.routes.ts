import { Router } from 'express';
import { AppointmentDocsService } from '../../services/AppointmentDocsService';

export function appointmentDocsRouter(): Router {
  const r = Router();

  // Lista los docs de una cita.
  r.get('/:appointmentId', async (req, res) => {
    try {
      res.json({ docs: await AppointmentDocsService.list(req.params.appointmentId) });
    } catch (e: any) { res.status(400).json({ error: e?.message ?? 'error' }); }
  });

  // Agrega un doc al checklist.
  r.post('/:appointmentId', async (req, res) => {
    try {
      const { account_id, documento } = req.body ?? {};
      if (!account_id || !documento) return res.status(400).json({ error: 'account_id y documento son obligatorios' });
      res.json({ doc: await AppointmentDocsService.add(req.params.appointmentId, account_id, String(documento).trim()) });
    } catch (e: any) { res.status(400).json({ error: e?.message ?? 'error' }); }
  });

  // Marca un doc entregado/pendiente.
  r.patch('/item/:id', async (req, res) => {
    try {
      const estado = req.body?.estado;
      if (estado !== 'pendiente' && estado !== 'entregado') return res.status(400).json({ error: 'estado inválido' });
      await AppointmentDocsService.setEstado(req.params.id, estado);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e?.message ?? 'error' }); }
  });

  // Borra un doc del checklist.
  r.delete('/item/:id', async (req, res) => {
    try {
      await AppointmentDocsService.remove(req.params.id);
      res.json({ ok: true });
    } catch (e: any) { res.status(400).json({ error: e?.message ?? 'error' }); }
  });

  return r;
}

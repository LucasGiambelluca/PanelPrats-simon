import { Router } from 'express';
import { AppointmentService } from '../../services/AppointmentService';

export function appointmentsRouter(): Router {
  const r = Router();

  // Listar citas
  r.get('/', async (req, res) => {
    try {
      const accountId = req.query.account_id as string;
      const list = await AppointmentService.list(accountId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Crear cita
  r.post('/', async (req, res) => {
    try {
      const { account_id, phone, nombre, telefono, resumen, status } = req.body;
      const newApp = await AppointmentService.create({
        account_id,
        phone: phone || telefono,
        nombre,
        telefono,
        resumen,
        status: status || 'pendiente'
      });
      res.json(newApp);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Actualizar cita (ej. cambiar status)
  r.put('/:id', async (req, res) => {
    try {
      const updated = await AppointmentService.update(req.params.id, req.body);
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Eliminar cita
  r.delete('/:id', async (req, res) => {
    try {
      await AppointmentService.delete(req.params.id);
      res.json({ ok: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}

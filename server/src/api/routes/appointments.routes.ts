import { Router } from 'express';
import { AppointmentService } from '../../services/AppointmentService';

export function appointmentsRouter(): Router {
  const r = Router();

  // Listar citas (requiere account_id para no exponer todas las cuentas)
  r.get('/', async (req, res) => {
    try {
      const accountId = req.query.account_id as string;
      if (!accountId) return res.status(400).json({ error: 'Falta account_id' });
      const list = await AppointmentService.list(accountId);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Crear cita
  r.post('/', async (req, res) => {
    try {
      const { account_id, phone, nombre, telefono, resumen, status, start_time, end_time, oficina } = req.body || {};
      if (!account_id || !nombre || !String(nombre).trim()) {
        return res.status(400).json({ error: 'account_id y nombre son requeridos' });
      }
      if (start_time && end_time && new Date(end_time).getTime() <= new Date(start_time).getTime()) {
        return res.status(400).json({ error: 'end_time debe ser posterior a start_time' });
      }
      const newApp = await AppointmentService.create({
        account_id,
        phone: phone || telefono,
        nombre,
        telefono,
        resumen,
        status: status || 'pendiente',
        start_time,
        end_time,
        oficina,
      });
      res.json(newApp);
    } catch (err: any) {
      if (String(err?.message) === 'SLOT_TAKEN') {
        return res.status(409).json({ error: 'Ese horario ya está ocupado en esa modalidad/oficina.' });
      }
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

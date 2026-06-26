import { Router } from 'express';
import { z } from 'zod';
import { AppointmentService } from '../../services/AppointmentService';
import { validateBody } from '../middleware/validate';

// Enums de la ficha de recepción (migración 0023). Deben coincidir con los CHECK del SQL.
const motivoEnum = z.enum([
  'jubilacion', 'puam', 'pension_v', 'reajuste', 'rti',
  'laboral', 'pension_discapacidad', 'asesoramiento_pago', 'otro',
]);
const canalEnum = z.enum([
  'whatsapp', 'facebook', 'instagram', 'tiktok', 'google', 'recomendada', 'pagina_web', 'otro',
]);
const resultadoEnum = z.enum(['si', 'no', 'pensar', 'traer_doc']);

// Campos de la ficha de recepción, compartidos entre crear y actualizar.
const intakeFields = {
  motivo: motivoEnum.nullish(),
  dni: z.string().nullish(),
  faltante: z.string().nullish(),
  canal_origen: canalEnum.nullish(),
  canal_auto: z.boolean().optional(),
  carpeta: z.boolean().optional(),
  seguimiento: z.string().nullish(),
  resultado: resultadoEnum.nullish(),
  atendido_por: z.string().uuid().nullish(),
};

const createAppointmentSchema = z.object({
  account_id: z.string().min(1),
  nombre: z.string().trim().min(1),
  phone: z.string().nullish(),
  telefono: z.string().nullish(),
  resumen: z.string().nullish(),
  status: z.string().nullish(),
  start_time: z.string().nullish(),
  end_time: z.string().nullish(),
  oficina: z.string().nullish(),
  assigned_profile_id: z.string().uuid().nullish(),
  ...intakeFields,
}).strict();

const updateAppointmentSchema = z.object({
  nombre: z.string().trim().min(1).optional(),
  phone: z.string().nullish(),
  telefono: z.string().nullish(),
  resumen: z.string().nullish(),
  status: z.string().nullish(),
  start_time: z.string().nullish(),
  end_time: z.string().nullish(),
  oficina: z.string().nullish(),
  reminded: z.boolean().optional(),
  assigned_profile_id: z.string().uuid().nullish(),
  ...intakeFields,
}).strict();

export function appointmentsRouter(): Router {
  const r = Router();

  // Listar citas (requiere account_id para no exponer todas las cuentas)
  r.get('/', async (req, res) => {
    try {
      // account_id ausente o 'all' => agenda unificada (todas las líneas del estudio).
      const accountId = req.query.account_id as string;
      const list = await AppointmentService.list(accountId && accountId !== 'all' ? accountId : undefined);
      res.json(list);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Crear cita
  r.post('/', validateBody(createAppointmentSchema), async (req, res) => {
    try {
      const {
        account_id, phone, nombre, telefono, resumen, status, start_time, end_time, oficina,
        assigned_profile_id, motivo, dni, faltante, canal_origen, canal_auto, carpeta,
        seguimiento, resultado, atendido_por,
      } = req.body || {};
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
        assigned_profile_id,
        motivo, dni, faltante, canal_origen, canal_auto, carpeta, seguimiento, resultado,
        // Si la empleada no especifica, la cita se atribuye a quien la crea.
        atendido_por: atendido_por ?? req.user?.id ?? null,
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
  r.put('/:id', validateBody(updateAppointmentSchema), async (req, res) => {
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

import { Router } from 'express';
import { z } from 'zod';
import { AppointmentService } from '../../services/AppointmentService';
import { validateBody } from '../middleware/validate';
import { AppointmentAuditor, type AuditInput } from '../../core/agent/context/AppointmentAuditor';
import { messageStore } from '../../services/MessageStore';
import { AIService } from '../../services/AIService';
import { supabase } from '../../config/supabase';
import { validarTelefonoAR } from '../../utils/phone-ar';

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

  const auditor = new AppointmentAuditor({ complete: (o) => AIService.complete(o) });
  const AUDIT_MAX = 50;

  // Audita las citas (account_id+rango, o ids puntuales). Persiste audit_json.
  r.post('/audit', async (req, res) => {
    try {
      const { account_id, ids } = req.body || {};
      let citas = await AppointmentService.list(account_id && account_id !== 'all' ? account_id : undefined);
      if (Array.isArray(ids) && ids.length) citas = citas.filter((c) => ids.includes(c.id));
      const truncated = citas.length > AUDIT_MAX;
      citas = citas.slice(0, AUDIT_MAX);

      let flagged = 0; let errored = 0;
      const results: any[] = [];
      for (const c of citas) {
        const transcript = await messageStore.getTranscript(c.account_id, c.phone).catch(() => '');
        let channel = 'whatsapp';
        try {
          const { data } = await supabase.from('accounts').select('channel').eq('id', c.account_id).maybeSingle();
          channel = (data as any)?.channel || 'whatsapp';
        } catch { /* default whatsapp */ }

        const input: AuditInput = {
          appointment: { nombre: c.nombre ?? null, telefono: c.telefono ?? null, start_time: c.start_time ?? null, end_time: c.end_time ?? null, oficina: c.oficina ?? null, motivo: (c.motivo as any) ?? null },
          transcript, channel, contactPhone: c.phone,
        };
        const result = await auditor.audit(input);
        if (result.error) errored++;
        if (result.revisar) flagged++;
        await AppointmentService.saveAudit(c.id, result).catch(() => {});
        results.push({ id: c.id, revisar: result.revisar, sin_chat: result.sin_chat, campos: result.campos });
      }

      res.json({ audited: citas.length, flagged, errored, truncated, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Mapea el campo del audit a la columna real de la cita.
  const AUDIT_FIELD_TO_COL: Record<string, 'telefono' | 'nombre' | 'motivo' | 'oficina'> = {
    telefono: 'telefono', nombre: 'nombre', motivo: 'motivo', oficina: 'oficina',
  };

  r.post('/:id/audit/apply', async (req, res) => {
    try {
      const { campo } = req.body || {};
      const col = AUDIT_FIELD_TO_COL[campo];
      if (!col) return res.status(400).json({ error: 'Campo no aplicable' });

      const appt: any = await AppointmentService.getById(req.params.id);
      if (!appt) return res.status(404).json({ error: 'Cita no encontrada' });
      const field = appt.audit_json?.campos?.find((c: any) => c.campo === campo);
      if (!field || field.sugerencia == null) return res.status(400).json({ error: 'No hay sugerencia para ese campo' });

      let valor = String(field.sugerencia);
      if (col === 'telefono') {
        const v = validarTelefonoAR(valor);
        if (!v.valido || !v.normalizado) return res.status(400).json({ error: 'La sugerencia de teléfono no es un número válido' });
        valor = v.normalizado;
      }

      const updated = await AppointmentService.update(req.params.id, { [col]: valor } as any);
      await AppointmentService.resolveAuditField(req.params.id, campo).catch(() => {});
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}

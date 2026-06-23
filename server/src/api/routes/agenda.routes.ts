import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../config/supabase';
import { AppointmentService } from '../../services/AppointmentService';
import { validateBody } from '../middleware/validate';

const assignSchema = z.object({ profile_id: z.string().uuid().nullable() }).strict();
const MAX_RANGE_MS = 31 * 86400000;

function rango(req: any, res: any): { from: number; to: number } | null {
  const from = Date.parse(req.query.from), to = Date.parse(req.query.to);
  if (!Number.isFinite(from) || !Number.isFinite(to)) { res.status(400).json({ error: 'from/to ISO requeridos' }); return null; }
  if (to <= from) { res.status(400).json({ error: 'to debe ser posterior a from' }); return null; }
  if (to - from > MAX_RANGE_MS) { res.status(400).json({ error: 'rango máximo 31 días' }); return null; }
  return { from, to };
}

const inRange = (a: any, from: number, to: number) =>
  a.start_time && new Date(a.start_time).getTime() < to && new Date(a.end_time || a.start_time).getTime() > from;

export function agendaRouter(): Router {
  const r = Router();

  // Agenda de una oficina (admin): columnas = profes + citas en rango, separando legacy.
  r.get('/offices/:id', async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Sin permiso' });
    const rg = rango(req, res); if (!rg) return;

    const { data: office, error: oErr } = await supabase.from('account_offices')
      .select('id, account_id, nombre').eq('id', req.params.id).maybeSingle();
    if (oErr) return res.status(400).json({ error: oErr.message });
    if (!office) return res.status(404).json({ error: 'Oficina no encontrada' });

    const { data: links } = await supabase.from('office_professionals')
      .select('profile_id, activa').eq('office_id', office.id);
    const profIds = (links ?? []).filter((l: any) => l.activa).map((l: any) => l.profile_id);
    const { data: profs } = await supabase.from('profiles').select('id, name').in('id', profIds.length ? profIds : ['00000000-0000-0000-0000-000000000000']);
    const profesionales = (profs ?? []).map((p: any) => ({ profile_id: p.id, name: p.name }));

    const all = await AppointmentService.list(office.account_id);
    const norm = (s: string) => (s || '').trim().toLowerCase();
    const ofAppts = all.filter((a: any) => norm(a.oficina) === norm(office.nombre) && inRange(a, rg.from, rg.to));
    const appointments = ofAppts.filter((a: any) => a.assigned_profile_id);
    const unassigned = ofAppts.filter((a: any) => !a.assigned_profile_id);
    res.json({ profesionales, appointments, unassigned });
  });

  // Agenda de un profesional (admin cualquiera; empleada solo la propia).
  r.get('/professionals/:id', async (req, res) => {
    if (req.user?.role !== 'admin' && req.user?.id !== req.params.id) {
      return res.status(403).json({ error: 'Sin permiso' });
    }
    const accountId = req.query.account_id as string;
    if (!accountId) return res.status(400).json({ error: 'Falta account_id' });
    const rg = rango(req, res); if (!rg) return;
    const all = await AppointmentService.list(accountId);
    const appointments = all.filter((a: any) => a.assigned_profile_id === req.params.id && inRange(a, rg.from, rg.to));
    res.json({ appointments });
  });

  // Reasignar / desasignar una cita (admin).
  r.patch('/appointments/:id/assign', validateBody(assignSchema), async (req, res) => {
    if (req.user?.role !== 'admin') return res.status(403).json({ error: 'Sin permiso' });
    try {
      const updated = await AppointmentService.update(req.params.id, { assigned_profile_id: req.body.profile_id });
      res.json(updated);
    } catch (err: any) {
      if (String(err?.message) === 'PROFESSIONAL_BUSY') return res.status(409).json({ error: 'Ese profesional ya tiene una cita solapada.' });
      if (String(err?.message) === 'SLOT_TAKEN') return res.status(409).json({ error: 'Ese horario ya está ocupado.' });
      res.status(500).json({ error: err.message });
    }
  });

  return r;
}

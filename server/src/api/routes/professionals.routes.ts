import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../config/supabase';
import { validateBody } from '../middleware/validate';

const HHMM = /^\d{2}:\d{2}$/;

const ventanaSchema = z.object({
  dia: z.number().int().min(0).max(6),
  hora_inicio: z.string().regex(HHMM),
  hora_fin: z.string().regex(HHMM),
}).strict().refine((v) => v.hora_fin > v.hora_inicio, { message: 'hora_fin debe ser posterior a hora_inicio' });

const availabilityPutSchema = z.object({ ventanas: z.array(ventanaSchema) }).strict();

const blockSchema = z.object({
  office_id: z.string().uuid().nullish(),
  start_time: z.string().datetime(),
  end_time: z.string().datetime(),
  motivo: z.string().nullish(),
}).strict().refine((b) => new Date(b.end_time) > new Date(b.start_time), { message: 'end_time debe ser posterior a start_time' });

export function professionalsRouter(): Router {
  const r = Router();

  // Profesionales asignables = profiles activos (incluye admin). Solo id/name/role.
  r.get('/', async (_req, res) => {
    const { data, error } = await supabase
      .from('profiles').select('id, name, role')
      .eq('active', true).order('name', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  // Disponibilidad de un profesional en una oficina.
  r.get('/:id/availability', async (req, res) => {
    const officeId = req.query.office_id as string;
    if (!officeId) return res.status(400).json({ error: 'Falta office_id' });
    const { data, error } = await supabase
      .from('professional_availability')
      .select('id, dia, hora_inicio, hora_fin')
      .eq('profile_id', req.params.id).eq('office_id', officeId)
      .order('dia', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  // Reemplaza el set completo de ventanas (profile_id, office_id).
  r.put('/:id/availability', validateBody(availabilityPutSchema), async (req, res) => {
    const officeId = req.query.office_id as string;
    if (!officeId) return res.status(400).json({ error: 'Falta office_id' });
    const { error: delErr } = await supabase
      .from('professional_availability')
      .delete().eq('profile_id', req.params.id).eq('office_id', officeId);
    if (delErr) return res.status(400).json({ error: delErr.message });
    const rows = (req.body.ventanas as any[]).map((v) => ({
      profile_id: req.params.id, office_id: officeId,
      dia: v.dia, hora_inicio: v.hora_inicio, hora_fin: v.hora_fin,
    }));
    if (rows.length === 0) return res.json([]);
    const { data, error } = await supabase
      .from('professional_availability').insert(rows).select('id, dia, hora_inicio, hora_fin');
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  // Bloqueos de un profesional.
  r.get('/:id/blocks', async (req, res) => {
    const { data, error } = await supabase
      .from('professional_blocks')
      .select('id, office_id, start_time, end_time, motivo')
      .eq('profile_id', req.params.id)
      .order('start_time', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  r.post('/:id/blocks', validateBody(blockSchema), async (req, res) => {
    const row = { profile_id: req.params.id, ...req.body };
    const { data, error } = await supabase
      .from('professional_blocks').insert(row).select('id, office_id, start_time, end_time, motivo').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.delete('/:id/blocks/:blockId', async (req, res) => {
    const { data, error } = await supabase
      .from('professional_blocks').delete()
      .eq('id', req.params.blockId).eq('profile_id', req.params.id)
      .select('id').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Bloqueo no encontrado' });
    res.json({ ok: true });
  });

  return r;
}

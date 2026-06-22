import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../config/supabase';
import { validateBody } from '../middleware/validate';

const createOfficeSchema = z.object({
  account_id: z.string().min(1),
  nombre: z.string().trim().min(1),
  modalidad: z.enum(['presencial', 'video']),
  direccion: z.string().nullish(),
  video_link: z.string().url().nullish(),
  dias: z.array(z.number().int().min(0).max(6)).default([1, 2, 3, 4, 5]),
  hora_inicio: z.string().regex(/^\d{2}:\d{2}$/),
  hora_fin: z.string().regex(/^\d{2}:\d{2}$/),
  slot_min: z.number().int().positive().default(60),
  capacidad: z.number().int().positive().default(1),
  buffer_min: z.number().int().min(0).default(0),
  activa: z.boolean().default(true),
  orden: z.number().int().default(0),
}).strict();
const updateOfficeSchema = createOfficeSchema.partial().strict();

function coherencia(b: any): string | null {
  if (b.modalidad === 'presencial' && !(b.direccion && String(b.direccion).trim())) return 'Una oficina presencial necesita dirección.';
  if (b.hora_inicio && b.hora_fin && b.hora_fin <= b.hora_inicio) return 'hora_fin debe ser posterior a hora_inicio.';
  return null;
}

export function officesRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const accountId = req.query.account_id as string;
    if (!accountId) return res.status(400).json({ error: 'Falta account_id' });
    const { data, error } = await supabase.from('account_offices').select('*').eq('account_id', accountId).order('orden', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data ?? []);
  });

  r.post('/', validateBody(createOfficeSchema), async (req, res) => {
    const err = coherencia(req.body);
    if (err) return res.status(400).json({ error: err });
    const { data, error } = await supabase.from('account_offices').insert(req.body).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.put('/:id', validateBody(updateOfficeSchema), async (req, res) => {
    const err = coherencia(req.body);
    if (err) return res.status(400).json({ error: err });
    const { data, error } = await supabase.from('account_offices').update({ ...req.body, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Oficina no encontrada' });
    res.json(data);
  });

  r.delete('/:id', async (req, res) => {
    const { error } = await supabase.from('account_offices').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  });

  return r;
}

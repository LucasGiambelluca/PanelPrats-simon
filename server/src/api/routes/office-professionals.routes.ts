import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../config/supabase';
import { validateBody } from '../middleware/validate';

const assignSchema = z.object({ profile_id: z.string().uuid() }).strict();

// Monta sub-rutas bajo /api/offices: /:id/professionals.
export function officeProfessionalsRouter(): Router {
  const r = Router();

  // Profesionales asignados a una oficina (con nombre del profile).
  r.get('/:id/professionals', async (req, res) => {
    const { data, error } = await supabase
      .from('office_professionals')
      .select('profile_id, activa, profiles(name, role)')
      .eq('office_id', req.params.id)
      .order('created_at', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    const out = (data ?? []).map((row: any) => ({
      profile_id: row.profile_id,
      activa: row.activa,
      name: row.profiles?.name ?? null,
      role: row.profiles?.role ?? null,
    }));
    res.json(out);
  });

  // Asignar (idempotente: upsert por PK office_id+profile_id).
  r.post('/:id/professionals', validateBody(assignSchema), async (req, res) => {
    const row = { office_id: req.params.id, profile_id: req.body.profile_id, activa: true };
    const { data, error } = await supabase
      .from('office_professionals')
      .upsert(row, { onConflict: 'office_id,profile_id' })
      .select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // Quitar.
  r.delete('/:id/professionals/:profileId', async (req, res) => {
    const { data, error } = await supabase
      .from('office_professionals')
      .delete()
      .eq('office_id', req.params.id).eq('profile_id', req.params.profileId)
      .select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Asignación no encontrada' });
    res.json({ ok: true });
  });

  return r;
}

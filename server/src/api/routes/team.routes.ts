import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../config/supabase';
import { validateBody } from '../middleware/validate';

const createEmpleadaSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'mínimo 8 caracteres'),
  name: z.string().trim().min(1).max(120).nullish(),
}).strict();

const updateEmpleadaSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  active: z.boolean().optional(),
}).strict();

const resetPasswordSchema = z.object({ password: z.string().min(8, 'mínimo 8 caracteres') }).strict();

/**
 * Gestión de empleadas (solo admin; el guard requireRole se monta en app.ts).
 * No hay borrado: revocar acceso = active=false (el middleware rechaza inactivas).
 */
export function teamRouter(): Router {
  const r = Router();

  // Listar empleadas con su email (de auth.users vía Admin API).
  r.get('/', async (_req, res) => {
    const { data: profiles, error } = await supabase
      .from('profiles').select('id, role, name, active, created_at')
      .eq('role', 'empleada').order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    const { data: list } = await supabase.auth.admin.listUsers();
    const emailById = new Map((list?.users ?? []).map((u: any) => [u.id, u.email]));
    res.json((profiles ?? []).map((p: any) => ({ ...p, email: emailById.get(p.id) ?? null })));
  });

  // Crear empleada: user en auth + profile role empleada.
  r.post('/', validateBody(createEmpleadaSchema), async (req, res) => {
    const { email, password, name } = req.body;
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data?.user) return res.status(400).json({ error: error?.message ?? 'no se pudo crear el usuario' });
    const { error: pErr } = await supabase
      .from('profiles').insert({ id: data.user.id, role: 'empleada', name: name ?? null, active: true });
    if (pErr) return res.status(400).json({ error: pErr.message });
    res.json({ id: data.user.id, email, name: name ?? null, role: 'empleada', active: true });
  });

  // Actualizar nombre / activar / desactivar.
  r.put('/:id', validateBody(updateEmpleadaSchema), async (req, res) => {
    const patch: Record<string, any> = {};
    if (req.body.name !== undefined) patch.name = req.body.name;
    if (req.body.active !== undefined) patch.active = !!req.body.active;
    const { data, error } = await supabase
      .from('profiles').update(patch).eq('id', req.params.id).eq('role', 'empleada').select('*').maybeSingle();
    if (error) return res.status(400).json({ error: error.message });
    if (!data) return res.status(404).json({ error: 'Empleada no encontrada' });
    res.json(data);
  });

  // Resetear password (solo de empleadas: verificamos el rol antes de tocar auth).
  r.post('/:id/reset-password', validateBody(resetPasswordSchema), async (req, res) => {
    const { password } = req.body;
    const { data: prof } = await supabase
      .from('profiles').select('role').eq('id', req.params.id).maybeSingle();
    if (!prof || prof.role !== 'empleada') return res.status(404).json({ error: 'Empleada no encontrada' });
    const { error } = await supabase.auth.admin.updateUserById(req.params.id, { password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  });

  return r;
}

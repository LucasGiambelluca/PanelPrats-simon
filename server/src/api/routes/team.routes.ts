import { Router } from 'express';
import { supabase } from '../../config/supabase';

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
  r.post('/', async (req, res) => {
    const { email, password, name } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email y password requeridos' });
    const { data, error } = await supabase.auth.admin.createUser({ email, password, email_confirm: true });
    if (error || !data?.user) return res.status(400).json({ error: error?.message ?? 'no se pudo crear el usuario' });
    const { error: pErr } = await supabase
      .from('profiles').insert({ id: data.user.id, role: 'empleada', name: name ?? null, active: true });
    if (pErr) return res.status(400).json({ error: pErr.message });
    res.json({ id: data.user.id, email, name: name ?? null, role: 'empleada', active: true });
  });

  // Actualizar nombre / activar / desactivar.
  r.put('/:id', async (req, res) => {
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
  r.post('/:id/reset-password', async (req, res) => {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'password requerido' });
    const { data: prof } = await supabase
      .from('profiles').select('role').eq('id', req.params.id).maybeSingle();
    if (!prof || prof.role !== 'empleada') return res.status(404).json({ error: 'Empleada no encontrada' });
    const { error } = await supabase.auth.admin.updateUserById(req.params.id, { password });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  });

  return r;
}

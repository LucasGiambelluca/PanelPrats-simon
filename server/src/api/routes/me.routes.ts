import { Router } from 'express';

/** Devuelve el usuario autenticado (id, rol, nombre). Requiere authContext montado antes. */
export function meRouter(): Router {
  const r = Router();
  r.get('/', (req, res) => {
    const u = req.user;
    if (!u) return res.status(401).json({ error: 'No autenticado' });
    res.json({ id: u.id, role: u.role, name: u.name, ver_todas_agendas: u.verTodasAgendas });
  });
  return r;
}

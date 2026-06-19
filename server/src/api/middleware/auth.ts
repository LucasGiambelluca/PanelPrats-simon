import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../../config/supabase';

export type Role = 'admin' | 'empleada';
export interface AuthUser { id: string; role: Role; name: string | null; }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

// Debe coincidir con el MOCK_USER del frontend (AuthContext.tsx).
const MOCK_ADMIN_ID = '03f6b5d7-febe-4af9-909b-70fba81e26af';
const isProd = () => process.env.NODE_ENV === 'production';

/** Valida el JWT de Supabase, carga el rol desde profiles y lo adjunta a req.user. */
export async function authContext(req: Request, res: Response, next: NextFunction) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  // Bypass de desarrollo: solo fuera de producción.
  if (token === 'dev-token') {
    if (isProd()) return res.status(401).json({ error: 'No autenticado' });
    req.user = { id: MOCK_ADMIN_ID, role: 'admin', name: 'Administrador (dev)' };
    return next();
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Token inválido' });

  const { data: prof } = await supabase
    .from('profiles').select('role, name, active').eq('id', data.user.id).maybeSingle();
  // active debe ser explícitamente true; null/undefined NO autentica (evita escalación silenciosa).
  if (!prof || prof.active !== true) return res.status(401).json({ error: 'Sin perfil o inactivo' });

  req.user = { id: data.user.id, role: prof.role as Role, name: prof.name ?? null };
  next();
}

/** Bloquea con 403 si el rol del usuario no coincide. */
export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) return res.status(403).json({ error: 'Sin permiso' });
    next();
  };
}

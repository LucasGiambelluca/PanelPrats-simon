import type { Request, Response, NextFunction } from 'express';
import { supabase } from '../../config/supabase';

export type Role = 'admin' | 'empleada';
export interface AuthUser { id: string; role: Role; name: string | null; verTodasAgendas: boolean; }

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

// Debe coincidir con el MOCK_USER del frontend (AuthContext.tsx).
const MOCK_ADMIN_ID = '03f6b5d7-febe-4af9-909b-70fba81e26af';
// Bypass de desarrollo: OPT-IN explícito. Nunca activo por defecto (no depende de
// que el deploy setee NODE_ENV). En prod simplemente NO se setea DEV_AUTH_BYPASS.
const devAuthEnabled = () =>
  process.env.DEV_AUTH_BYPASS === '1' && process.env.NODE_ENV !== 'production';

/** Valida el JWT de Supabase, carga el rol desde profiles y lo adjunta a req.user. */
export async function authContext(req: Request, res: Response, next: NextFunction) {
  const header = req.header('Authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token) return res.status(401).json({ error: 'No autenticado' });

  // Bypass de desarrollo: solo si DEV_AUTH_BYPASS=1 está explícitamente seteado.
  if (token === 'dev-token') {
    if (!devAuthEnabled()) return res.status(401).json({ error: 'No autenticado' });
    req.user = { id: MOCK_ADMIN_ID, role: 'admin', name: 'Administrador (dev)', verTodasAgendas: true };
    return next();
  }

  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return res.status(401).json({ error: 'Token inválido' });

  // select('*') (no columnas fijas): resiliente si la migración 0033 (ver_todas_agendas)
  // todavía no se aplicó — un select con columna ausente erroraría y dejaría sin auth a todos.
  const { data: prof } = await supabase
    .from('profiles').select('*').eq('id', data.user.id).maybeSingle();
  // active debe ser explícitamente true; null/undefined NO autentica (evita escalación silenciosa).
  if (!prof || prof.active !== true) return res.status(401).json({ error: 'Sin perfil o inactivo' });

  req.user = {
    id: data.user.id,
    role: prof.role as Role,
    name: prof.name ?? null,
    verTodasAgendas: (prof as any).ver_todas_agendas === true,
  };
  next();
}

/** Bloquea con 403 si el rol del usuario no coincide. */
export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.user?.role !== role) return res.status(403).json({ error: 'Sin permiso' });
    next();
  };
}

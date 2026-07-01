-- 0033: capacidad por perfil "ver todas las agendas".
-- Una empleada con este flag ve la agenda de TODOS los profesionales (solo lectura),
-- sin ganar el resto de permisos de admin (flujos/config/cuentas siguen bloqueados).
-- El reasignar de citas sigue siendo admin-only.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS ver_todas_agendas boolean NOT NULL DEFAULT false;

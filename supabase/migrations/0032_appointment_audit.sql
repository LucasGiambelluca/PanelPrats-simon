-- 0032: auditoría de citas. Resultado del auditor (discrepancias + sugerencias)
-- por cita, persistido para mostrar badge "revisar" y aplicar correcciones en 1 clic.
-- Idempotente; filas viejas quedan con audit_json NULL (sin auditar) → sin badge.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS audit_json jsonb,
  ADD COLUMN IF NOT EXISTS audit_at   timestamptz;

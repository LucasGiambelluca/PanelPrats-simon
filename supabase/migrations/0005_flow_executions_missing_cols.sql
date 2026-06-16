-- 0005: columnas faltantes en flow_executions que SessionRepository escribe/ordena.
-- Sin ellas, update()/archive() tiran PGRST204 y el FlowEngine cae al catch
-- ("⚠️ Ocurrió un error") pese a haber ejecutado el flujo correctamente.

ALTER TABLE flow_executions
  ADD COLUMN IF NOT EXISTS updated_at      timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS archived_reason text;

CREATE INDEX IF NOT EXISTS idx_flowexec_updated_at ON flow_executions(updated_at);

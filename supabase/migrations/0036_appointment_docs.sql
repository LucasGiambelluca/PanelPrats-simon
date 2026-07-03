-- 0036: checklist de documentación por cita. Cada fila es un documento con estado
-- pedido/entregado. Reemplaza (sin borrar) el texto libre appointments.faltante.
CREATE TABLE IF NOT EXISTS appointment_docs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id uuid NOT NULL REFERENCES appointments(id) ON DELETE CASCADE,
  account_id     text NOT NULL,
  documento      text NOT NULL,
  estado         text NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente','entregado')),
  requested_at   timestamptz NOT NULL DEFAULT now(),
  delivered_at   timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_appointment_docs_appt ON appointment_docs(appointment_id);

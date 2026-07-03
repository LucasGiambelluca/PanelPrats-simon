-- 0035: estado "llamado" de la planilla Pendientes de llamar. Idempotente.
-- Clave (account_id, telefono) = teléfono real normalizado (misma clave que el dedup
-- de PendienteEvaluator). La PRESENCIA de la fila significa "ya lo llamamos"; su
-- ausencia = "no llamado". No hace falta columna booleana.
CREATE TABLE IF NOT EXISTS contactos_llamados (
  account_id  text        NOT NULL,
  telefono    text        NOT NULL,
  llamado_at  timestamptz NOT NULL DEFAULT now(),
  llamado_por text,
  PRIMARY KEY (account_id, telefono)
);

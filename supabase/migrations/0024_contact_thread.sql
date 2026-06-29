-- 0024: continuidad conversacional ("memoria de empleado"). Idempotente.
-- Da al agente un puntero de hilo abierto + detección de "contacto que vuelve",
-- para retomar en vez de arrancar de cero (menú frío).

ALTER TABLE contact_memory
  ADD COLUMN IF NOT EXISTS last_topic          text,
  ADD COLUMN IF NOT EXISTS last_interaction_at timestamptz,
  ADD COLUMN IF NOT EXISTS current_thread      jsonb;   -- { tema, paso, datos_parciales }

-- Para listar/ordenar contactos por última interacción (panel + rehidratación).
CREATE INDEX IF NOT EXISTS idx_contact_memory_last_interaction
  ON contact_memory (account_id, last_interaction_at DESC);

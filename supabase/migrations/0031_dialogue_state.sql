-- 0031: capa de interpretación + dialogue state.
-- Estado conversacional explícito por contacto + cierre/opt-out por conversación.
-- Idempotente (IF NOT EXISTS), defaults seguros: todo lo viejo arranca con
-- dialogue_state={} y opt_out=false; ninguna fila existente se rompe.

-- Estado del diálogo + opt-out por contacto (PK account_id+phone).
ALTER TABLE contact_memory
  ADD COLUMN IF NOT EXISTS dialogue_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS opt_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opt_out_at timestamptz;

-- Cierre de conversación (para no re-enganchar lo cerrado / opt-out).
-- close_reason: completada | opt_out | despedida | frustracion_handoff
ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS closed_at timestamptz,
  ADD COLUMN IF NOT EXISTS close_reason text;

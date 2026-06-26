-- 0028: re-enganche nocturno. Opt-in por cuenta + texto + marca de idempotencia
-- (el last_message_at por el que ya se re-enganchó esa conversación). Idempotente.
ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS reengage_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS reengage_text    text;

ALTER TABLE whatsapp_conversations
  ADD COLUMN IF NOT EXISTS reengaged_for timestamptz;

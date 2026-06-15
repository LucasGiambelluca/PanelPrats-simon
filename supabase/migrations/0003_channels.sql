-- Migración 0003: soporte omnicanal (WhatsApp + Facebook Messenger + Instagram Direct)
-- Agrega metadatos de canal a accounts y etiqueta conversaciones/mensajes por canal.
-- Idempotente (IF NOT EXISTS) para poder re-aplicarse sin error.

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS channel text NOT NULL DEFAULT 'whatsapp'
  CHECK (channel IN ('whatsapp','facebook','instagram'));
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS external_id text;     -- FB page id / IG account id
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS access_token text;    -- Meta Page Access Token
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS app_secret text;      -- para verificar firma del webhook
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS verify_token text;    -- para el GET de verificación del webhook
ALTER TABLE whatsapp_conversations ADD COLUMN IF NOT EXISTS channel text DEFAULT 'whatsapp';
ALTER TABLE whatsapp_messages ADD COLUMN IF NOT EXISTS channel text DEFAULT 'whatsapp';
CREATE INDEX IF NOT EXISTS idx_accounts_external ON accounts(external_id);

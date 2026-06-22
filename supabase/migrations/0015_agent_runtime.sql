-- 0015: runtime del agente IA-primero. Idempotente.

-- Memoria largo plazo por contacto (1 fila por account_id+phone).
CREATE TABLE IF NOT EXISTS contact_memory (
  account_id        uuid NOT NULL,
  phone             text NOT NULL,
  profile           jsonb NOT NULL DEFAULT '{}'::jsonb,
  preferences       jsonb NOT NULL DEFAULT '{}'::jsonb,
  long_term_summary text,
  last_summary_at   timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, phone)
);
ALTER TABLE contact_memory ENABLE ROW LEVEL SECURITY;

-- Base de conocimiento por cuenta (grounding estricto de FAQ).
CREATE TABLE IF NOT EXISTS account_faqs (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL,
  pregunta   text NOT NULL,
  respuesta  text NOT NULL,
  tags       text[] DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_faqs_account ON account_faqs(account_id);
ALTER TABLE account_faqs ENABLE ROW LEVEL SECURITY;

-- Config del agente en accounts.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_mode    text DEFAULT 'flows';  -- 'flows' | 'ai_first'
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_name    text DEFAULT 'Sofía';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_persona text;

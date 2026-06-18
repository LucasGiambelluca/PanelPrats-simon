-- 0008: configuración del Agente IA de soporte global, por cuenta.
-- El agente interviene cuando un mensaje no matchea ningún flujo (off-script) o
-- cuando el usuario responde algo inesperado dentro de un flujo. Entiende la
-- intención y rutea al flujo correcto; si no puede, deriva a humano.
-- Idempotente.

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ai_support_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ai_api_key text;

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ai_model text DEFAULT 'gpt-4o-mini';

ALTER TABLE accounts
  ADD COLUMN IF NOT EXISTS ai_support_prompt text;

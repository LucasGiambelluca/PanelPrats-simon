-- Migración 0004: soporte para proveedor de WhatsApp (Baileys vs API Oficial) y mapeo directo de flujo activo.
-- Idempotente (IF NOT EXISTS) para poder re-aplicarse sin error.

-- 1. Agregar columna provider a accounts para elegir entre baileys y official
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'baileys'
  CHECK (provider IN ('baileys', 'official'));

-- 2. Agregar columna flow_id a accounts para asociar la línea a un flujo de bot específico
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS flow_id uuid REFERENCES flows(id) ON DELETE SET NULL;

-- 3. Crear índice para optimizar la búsqueda de flujos por cuenta
CREATE INDEX IF NOT EXISTS idx_accounts_flow_id ON accounts(flow_id);

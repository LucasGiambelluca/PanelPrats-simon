-- 0009: salas de videollamada (Daily) con invitaciones de acceso por guest-token.
-- El operador crea la sala y genera un enlace de invitado; el lead entra con 1 click,
-- sin login. El token del enlace se guarda HASHEADO (sha256), nunca en plano.
-- Idempotente.

CREATE TABLE IF NOT EXISTS salas (
  id             uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  account_id     uuid REFERENCES accounts(id) ON DELETE SET NULL,
  appointment_id uuid,
  titulo         text,
  daily_room     text NOT NULL,          -- nombre de la room en Daily
  daily_url      text NOT NULL,          -- URL completa de la room
  estado         text NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa','cerrada')),
  created_by     uuid,
  created_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS invitaciones (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  sala_id     uuid NOT NULL REFERENCES salas(id) ON DELETE CASCADE,
  nombre      text NOT NULL,
  token_hash  text NOT NULL,             -- sha256 del invite_token (NUNCA en plano)
  created_at  timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz                -- primer uso (auditoría)
);

CREATE INDEX IF NOT EXISTS idx_invitaciones_hash ON invitaciones(token_hash);
CREATE INDEX IF NOT EXISTS idx_salas_account ON salas(account_id);

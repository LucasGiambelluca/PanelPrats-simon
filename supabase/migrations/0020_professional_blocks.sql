-- 0020: bloqueos puntuales de un profesional (vacaciones/ocupado). Idempotente.
-- office_id NULL = bloquea en todas las oficinas del profesional.
CREATE TABLE IF NOT EXISTS professional_blocks (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  office_id   uuid REFERENCES account_offices(id) ON DELETE CASCADE,
  start_time  timestamptz NOT NULL,
  end_time    timestamptz NOT NULL,
  motivo      text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  CHECK (end_time > start_time)
);
CREATE INDEX IF NOT EXISTS idx_prof_blocks_profile ON professional_blocks(profile_id);
ALTER TABLE professional_blocks ENABLE ROW LEVEL SECURITY;

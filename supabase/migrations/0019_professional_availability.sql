-- 0019: horario base semanal de un profesional en una oficina. Idempotente.
-- Varias filas por (profile_id, office_id, dia) = varias ventanas (ej. 09-12 y 15-18).
CREATE TABLE IF NOT EXISTS professional_availability (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id   uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  office_id    uuid NOT NULL REFERENCES account_offices(id) ON DELETE CASCADE,
  dia          smallint NOT NULL CHECK (dia BETWEEN 0 AND 6),
  hora_inicio  text NOT NULL,
  hora_fin     text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_prof_avail_office  ON professional_availability(office_id);
CREATE INDEX IF NOT EXISTS idx_prof_avail_profile ON professional_availability(profile_id);
ALTER TABLE professional_availability ENABLE ROW LEVEL SECURITY;

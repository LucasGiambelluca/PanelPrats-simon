-- 0018: asignación profesional <-> oficina. Idempotente.
CREATE TABLE IF NOT EXISTS office_professionals (
  office_id   uuid NOT NULL REFERENCES account_offices(id) ON DELETE CASCADE,
  profile_id  uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  activa      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (office_id, profile_id)
);
CREATE INDEX IF NOT EXISTS idx_office_prof_profile ON office_professionals(profile_id);
ALTER TABLE office_professionals ENABLE ROW LEVEL SECURITY;

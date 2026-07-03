-- 0037: flags de idempotencia para el scheduler de proactivos (reminder 24h,
-- seguimiento post-reunión, chase de documentación). Idempotente.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS reminder_24h_sent boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS followup_sent     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS doc_chase_count   int     NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS doc_chase_last_at timestamptz;
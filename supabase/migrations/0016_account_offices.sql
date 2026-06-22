-- 0016: config de agenda por oficina/modalidad a nivel cuenta. Idempotente.
CREATE TABLE IF NOT EXISTS account_offices (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id   uuid NOT NULL,
  nombre       text NOT NULL,
  modalidad    text NOT NULL DEFAULT 'presencial',  -- 'presencial' | 'video'
  direccion    text,
  video_link   text,
  dias         int[] NOT NULL DEFAULT '{1,2,3,4,5}',
  hora_inicio  text NOT NULL DEFAULT '09:00',
  hora_fin     text NOT NULL DEFAULT '18:00',
  slot_min     int  NOT NULL DEFAULT 60,
  capacidad    int  NOT NULL DEFAULT 1,
  buffer_min   int  NOT NULL DEFAULT 0,
  activa       boolean NOT NULL DEFAULT true,
  orden        int  NOT NULL DEFAULT 0,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_account_offices_account ON account_offices(account_id);
ALTER TABLE account_offices ENABLE ROW LEVEL SECURITY;

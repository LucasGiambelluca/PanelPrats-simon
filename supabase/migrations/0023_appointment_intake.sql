-- 0023: ficha de recepción en la cita. Campos de la planilla de recepción que las
-- empleadas completan mientras atienden + base para analíticas del admin. Idempotente.
--
-- Ejes separados a propósito:
--   status    = ciclo de la reunión (pendiente/confirmada/.../cerrado)  -- ya existe
--   resultado = disposición del lead (SI/NO/PENSAR/TRAER DOCUMENTACIÓN) -- nuevo
--   atendido_por        = empleada/recepcionista que atendió            -- nuevo
--   assigned_profile_id = abogada/profesional asignado                  -- ya existe (0021)

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS motivo       text,
  ADD COLUMN IF NOT EXISTS dni          text,
  ADD COLUMN IF NOT EXISTS faltante     text,
  ADD COLUMN IF NOT EXISTS canal_origen text,
  ADD COLUMN IF NOT EXISTS canal_auto   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS carpeta      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS seguimiento  text,
  ADD COLUMN IF NOT EXISTS resultado    text,
  ADD COLUMN IF NOT EXISTS atendido_por uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Enums vía CHECK (permiten NULL = sin cargar todavía). Se dropean y recrean para idempotencia.
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_motivo_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_motivo_check
  CHECK (motivo IS NULL OR motivo IN (
    'jubilacion','puam','pension_v','reajuste','rti','laboral',
    'pension_discapacidad','asesoramiento_pago','otro'));

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_canal_origen_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_canal_origen_check
  CHECK (canal_origen IS NULL OR canal_origen IN (
    'whatsapp','facebook','instagram','tiktok','google','recomendada','pagina_web','otro'));

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_resultado_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_resultado_check
  CHECK (resultado IS NULL OR resultado IN ('si','no','pensar','traer_doc'));

-- Índices para las agregaciones del dashboard de analíticas.
CREATE INDEX IF NOT EXISTS idx_appt_intake_analytics
  ON appointments (account_id, created_at, resultado, canal_origen, motivo);
CREATE INDEX IF NOT EXISTS idx_appt_atendido
  ON appointments (atendido_por);

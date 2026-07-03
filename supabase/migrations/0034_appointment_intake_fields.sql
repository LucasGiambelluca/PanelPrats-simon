-- 0034: campos de intake estructurados en la cita. Idempotente.
-- La ficha IA (0025) deja edad/dni/zona en NULL seguido; estos campos se llenan
-- COPIANDO la calificación vigente del contacto (dato ya validado) al agendar.
-- tipo_consulta/monto_a_cobrar: la recepcionista debe saber si la consulta se cobra.
ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS edad            int,
  ADD COLUMN IF NOT EXISTS zona            text,
  ADD COLUMN IF NOT EXISTS nacionalidad    text,       -- 'argentino' | 'extranjero'
  ADD COLUMN IF NOT EXISTS insalubres      boolean,
  ADD COLUMN IF NOT EXISTS aportes_aprox   int,
  ADD COLUMN IF NOT EXISTS area            text,        -- jubilacion_hombre/mujer/... (área de calificación)
  ADD COLUMN IF NOT EXISTS tipo_consulta   text,        -- 'gratis' | 'pago'
  ADD COLUMN IF NOT EXISTS monto_a_cobrar  int DEFAULT 0;
-- dni ya existe (0023).

-- 0011: la metadata de la cita pasa de estar empaquetada en `resumen` (JSON) a
-- columnas reales. Permite consultar/indexar por horario y evita corrupción cuando
-- la nota del cliente parece JSON.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS start_time timestamptz,
  ADD COLUMN IF NOT EXISTS end_time   timestamptz,
  ADD COLUMN IF NOT EXISTS reminded   boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS oficina    text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Backfill: extrae los campos del "envelope" JSON que hoy vive en `resumen` y deja
-- `resumen` como texto plano (parsed.text). Por fila, con manejo de excepción para
-- saltear filas que no son JSON válido (notas crudas).
DO $$
DECLARE
  r RECORD;
  j jsonb;
BEGIN
  FOR r IN
    SELECT id, resumen FROM appointments
    WHERE resumen IS NOT NULL AND left(btrim(resumen), 1) IN ('{', '[')
  LOOP
    BEGIN
      j := r.resumen::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE; -- no es JSON válido → dejar el texto como está
    END;

    IF jsonb_typeof(j) = 'object' AND (j ? 'text' OR j ? 'start_time') THEN
      UPDATE appointments SET
        start_time = NULLIF(j->>'start_time', '')::timestamptz,
        end_time   = NULLIF(j->>'end_time', '')::timestamptz,
        reminded   = COALESCE((j->>'reminded')::boolean, false),
        oficina    = j->>'oficina',
        resumen    = COALESCE(j->>'text', '')
      WHERE id = r.id;
    END IF;
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS idx_appointments_start_time ON appointments(start_time);

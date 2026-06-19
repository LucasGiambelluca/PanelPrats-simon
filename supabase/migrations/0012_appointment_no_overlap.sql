-- 0012: previene doble-booking a nivel DB (cierra la ventana TOCTOU del chequeo en app).
-- No puede haber dos citas NO canceladas que se solapen en el mismo (account_id, oficina).
-- Requiere btree_gist para combinar igualdad (=) con solapamiento de rangos (&&).
--
-- NOTA: si ya existen citas solapadas en la tabla, el ALTER falla. En ese caso,
-- limpiá/cancelá los solapes antes de re-aplicar. Idempotente ante re-ejecución.

CREATE EXTENSION IF NOT EXISTS btree_gist;

DO $$
BEGIN
  ALTER TABLE appointments
    ADD CONSTRAINT appointments_no_overlap
    EXCLUDE USING gist (
      account_id WITH =,
      lower(coalesce(oficina, '')) WITH =,
      tstzrange(start_time, end_time) WITH &&
    )
    WHERE (status <> 'cancelada' AND start_time IS NOT NULL AND end_time IS NOT NULL);
EXCEPTION
  WHEN duplicate_object THEN NULL;  -- ya aplicada
END $$;

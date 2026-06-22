-- 0017: capacidad por oficina. Reemplaza el EXCLUDE de capacidad-1 (0012) por un
-- trigger que cuenta solapamientos contra account_offices.capacidad, con advisory
-- lock por (cuenta, oficina) para serializar reservas y evitar overbooking.
-- Oficina no configurada → capacidad 1 (comportamiento viejo). Idempotente.

ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_no_overlap;

CREATE OR REPLACE FUNCTION check_office_capacity() RETURNS trigger AS $$
DECLARE
  cap int;
  ocupadas int;
BEGIN
  IF NEW.status = 'cancelada' OR NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.account_id::text || '|' || lower(coalesce(NEW.oficina, ''))));

  SELECT capacidad INTO cap FROM account_offices
   WHERE account_id = NEW.account_id
     AND lower(nombre) = lower(coalesce(NEW.oficina, '')) AND activa
   LIMIT 1;
  cap := COALESCE(cap, 1);

  SELECT count(*) INTO ocupadas FROM appointments a
   WHERE a.account_id = NEW.account_id
     AND a.id <> NEW.id
     AND a.status <> 'cancelada'
     AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
     AND lower(coalesce(a.oficina, '')) = lower(coalesce(NEW.oficina, ''))
     AND tstzrange(a.start_time, a.end_time) && tstzrange(NEW.start_time, NEW.end_time);

  IF ocupadas >= cap THEN
    RAISE EXCEPTION 'office_capacity_full' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_office_capacity ON appointments;
CREATE TRIGGER trg_office_capacity
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION check_office_capacity();

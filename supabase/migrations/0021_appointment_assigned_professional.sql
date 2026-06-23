-- 0021: profesional asignado a una cita + capacidad por profesionales.
-- Reemplaza la función check_office_capacity (0017). Idempotente.
-- La disponibilidad horaria (ventanas/bloqueos) la evalúa AvailabilityService en la app;
-- el trigger sólo garantiza: (1) no-overlap por profesional asignado, (2) fallback de
-- capacidad fija para oficinas SIN profesionales asignados.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS assigned_profile_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_appt_assigned_prof
  ON appointments(assigned_profile_id, start_time);

CREATE OR REPLACE FUNCTION check_office_capacity() RETURNS trigger AS $$
DECLARE
  n_profs int;
  cap int;
  ocupadas int;
  solapados int;
BEGIN
  IF NEW.status = 'cancelada' OR NEW.start_time IS NULL OR NEW.end_time IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtext(NEW.account_id::text || '|' || lower(coalesce(NEW.oficina, ''))));

  -- (1) No-overlap por profesional asignado.
  IF NEW.assigned_profile_id IS NOT NULL THEN
    SELECT count(*) INTO solapados FROM appointments a
     WHERE a.account_id = NEW.account_id
       AND a.id <> NEW.id
       AND a.status <> 'cancelada'
       AND a.assigned_profile_id = NEW.assigned_profile_id
       AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
       AND tstzrange(a.start_time, a.end_time) && tstzrange(NEW.start_time, NEW.end_time);
    IF solapados > 0 THEN
      RAISE EXCEPTION 'professional_busy' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (2) Capacidad de oficina: cuántos profes activos tiene.
  SELECT count(*) INTO n_profs
    FROM office_professionals op
    JOIN account_offices o ON o.id = op.office_id
   WHERE op.activa
     AND o.account_id = NEW.account_id
     AND lower(o.nombre) = lower(coalesce(NEW.oficina, ''));

  IF COALESCE(n_profs, 0) = 0 THEN
    -- Fallback modelo viejo: capacidad fija vs solapamientos totales de la oficina.
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
  END IF;
  -- n_profs > 0: la capacidad la garantizan (1) no-overlap por persona + la asignación
  -- previa que ya eligió un prof libre (AvailabilityService). No se recalcula aquí.

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_office_capacity ON appointments;
CREATE TRIGGER trg_office_capacity
  BEFORE INSERT OR UPDATE ON appointments
  FOR EACH ROW EXECUTE FUNCTION check_office_capacity();

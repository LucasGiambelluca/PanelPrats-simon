-- 0022: no-overlap y capacidad ORG-WIDE (single-org).
-- Reescribe check_office_capacity (0021) para que el no-overlap por profesional y la
-- capacidad de oficina sean GLOBALES del estudio (las agendas se comparten entre todos
-- los canales: WhatsApp/FB/IG), no scoped por account_id. Idempotente (CREATE OR REPLACE).
-- Así una chica no puede tener dos citas que se pisen aunque vengan de canales distintos.

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

  -- Lock por profesional (si hay) o por oficina — GLOBAL (sin account_id) para
  -- serializar reservas concurrentes de cualquier canal sobre el mismo recurso.
  PERFORM pg_advisory_xact_lock(hashtext(
    coalesce(NEW.assigned_profile_id::text, lower(coalesce(NEW.oficina, '')))
  ));

  -- (1) No-overlap por profesional asignado — ORG-WIDE (sin a.account_id = NEW.account_id).
  IF NEW.assigned_profile_id IS NOT NULL THEN
    SELECT count(*) INTO solapados FROM appointments a
     WHERE a.id <> NEW.id
       AND a.status <> 'cancelada'
       AND a.assigned_profile_id = NEW.assigned_profile_id
       AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
       AND tstzrange(a.start_time, a.end_time) && tstzrange(NEW.start_time, NEW.end_time);
    IF solapados > 0 THEN
      RAISE EXCEPTION 'professional_busy' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  -- (2) Capacidad de oficina (ORG-WIDE): cuántos profes activos tiene la agenda.
  SELECT count(*) INTO n_profs
    FROM office_professionals op
    JOIN account_offices o ON o.id = op.office_id
   WHERE op.activa
     AND lower(o.nombre) = lower(coalesce(NEW.oficina, ''));

  IF COALESCE(n_profs, 0) = 0 THEN
    -- Fallback modelo viejo: capacidad fija vs solapamientos totales de la oficina.
    SELECT capacidad INTO cap FROM account_offices
     WHERE lower(nombre) = lower(coalesce(NEW.oficina, '')) AND activa
     LIMIT 1;
    cap := COALESCE(cap, 1);

    SELECT count(*) INTO ocupadas FROM appointments a
     WHERE a.id <> NEW.id
       AND a.status <> 'cancelada'
       AND a.start_time IS NOT NULL AND a.end_time IS NOT NULL
       AND lower(coalesce(a.oficina, '')) = lower(coalesce(NEW.oficina, ''))
       AND tstzrange(a.start_time, a.end_time) && tstzrange(NEW.start_time, NEW.end_time);

    IF ocupadas >= cap THEN
      RAISE EXCEPTION 'office_capacity_full' USING ERRCODE = 'check_violation';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- El trigger trg_office_capacity ya apunta a esta función (0021); CREATE OR REPLACE basta.

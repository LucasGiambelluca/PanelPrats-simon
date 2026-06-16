-- 0007: amplía los estados de cita para el ciclo de vida del caso.
-- pendiente/confirmada/cancelada + asistio, no_asistio (recontactar), cerrado (caso ganado).
ALTER TABLE appointments DROP CONSTRAINT IF EXISTS appointments_status_check;
ALTER TABLE appointments ADD CONSTRAINT appointments_status_check
  CHECK (status IN ('pendiente', 'confirmada', 'cancelada', 'asistio', 'no_asistio', 'cerrado'));

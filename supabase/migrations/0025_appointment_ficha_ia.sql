-- 0025: ficha IA al agendar. Idempotente.
-- Enriquecimiento pre-booking: resumen natural + snapshot estructurado del perfil
-- al momento de agendar, para que el profesional tenga contexto sin leer todo el chat.
-- Reusa las columnas de la 0023 (motivo, dni, …) donde aplica; estas dos son nuevas.

ALTER TABLE appointments
  ADD COLUMN IF NOT EXISTS resumen_ia  text,
  ADD COLUMN IF NOT EXISTS perfil_json jsonb;   -- snapshot estructurado (edad, anios_aporte, zona…)

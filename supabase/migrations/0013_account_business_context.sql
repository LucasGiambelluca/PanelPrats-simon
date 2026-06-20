-- Datos del estudio por cuenta: única fuente para que la IA responda preguntas
-- generales (horario, servicios, dirección) sin inventar. Si está vacío, la IA deriva.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS business_context text DEFAULT '';

COMMENT ON COLUMN accounts.business_context IS
  'Texto libre: horario, servicios, dirección, qué hace y qué NO hace el estudio. Fuente de la acción answer del agente IA.';

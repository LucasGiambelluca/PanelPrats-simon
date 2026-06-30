-- 0030: memoria de calificación por área + TTL de reuso configurable por cuenta.
-- contact_memory.calificacion: mapa { area_key: { resultado, datos, calificado_at } }.
ALTER TABLE contact_memory ADD COLUMN IF NOT EXISTS calificacion jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS calificacion_ttl_days integer DEFAULT 30;

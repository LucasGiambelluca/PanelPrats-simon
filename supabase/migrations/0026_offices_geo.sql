-- 0026: geo-routing. Idempotente.
-- Gazetteer editable (partido/barrio → oficina) para sugerir la oficina más cercana
-- sin geocoding online. lat/lng en account_offices quedan para un futuro ranking fino.

ALTER TABLE account_offices
  ADD COLUMN IF NOT EXISTS lat numeric,
  ADD COLUMN IF NOT EXISTS lng numeric;

-- Diccionario localidad→oficina. DATO (no código): se suman localidades sin deploy.
CREATE TABLE IF NOT EXISTS zone_gazetteer (
  id          bigserial PRIMARY KEY,
  account_id  uuid NOT NULL,
  alias       text NOT NULL,        -- "Lanús", "Ramos Mejía", "Caballito"
  alias_norm  text NOT NULL,        -- normalizado (sin acentos, minúsculas)
  oficina     text NOT NULL,        -- 'CABA' | 'Quilmes' | 'Haedo'
  UNIQUE (account_id, alias_norm)
);
CREATE INDEX IF NOT EXISTS idx_gazetteer_lookup ON zone_gazetteer (account_id, alias_norm);
ALTER TABLE zone_gazetteer ENABLE ROW LEVEL SECURITY;

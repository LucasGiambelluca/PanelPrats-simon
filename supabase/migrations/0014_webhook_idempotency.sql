-- 0014: idempotencia de webhooks a nivel DB (defensa en profundidad).
-- El guard primario es el "claim" en Redis (services/idempotency.ts). Este
-- índice único parcial evita filas duplicadas si el claim falla (Redis caído)
-- o ante una carrera: dos webhooks reintentados con el mismo wa_message_id no
-- pueden insertarse dos veces. Los OUTBOUND (wa_message_id NULL) no se afectan:
-- el índice es parcial sobre NOT NULL.
--
-- NOTA: si ya existen filas con wa_message_id duplicado, la creación falla.
-- Limpiá los duplicados antes de re-aplicar. Idempotente ante re-ejecución.

CREATE UNIQUE INDEX IF NOT EXISTS uq_wamsg_wa_message_id
  ON whatsapp_messages (wa_message_id)
  WHERE wa_message_id IS NOT NULL;

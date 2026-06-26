-- 0027: "procedimientos" del agente (flujos → instrucciones en lenguaje natural).
-- El cerebro editable del apartado Agente los guarda acá; el runtime IA-primero los
-- inyecta al system prompt. Idempotente.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_procedures text;

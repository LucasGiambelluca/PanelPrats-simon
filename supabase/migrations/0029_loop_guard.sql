-- 0029: LoopGuard — tope de llamadas IA por contacto para que el agente nunca
-- entre en un loop interminable (contestar una y otra vez quemando API).
--
-- accounts.agent_loop_guard  : config por cuenta (jsonb). null = defaults del runtime.
--   { enabled, maxCalls, windowMin, echoGuard, echoLookback, action }
--   - maxCalls/windowMin : ventana deslizante (windowMin=0 → tope total sin reset).
--   - echoGuard/echoLookback : corta si repite una respuesta casi idéntica.
--   - action : 'handoff' (deriva a humano) | 'silence' | 'cooldown'.
-- contact_memory.loop_guard_state : contador por contacto (jsonb), { calls:[ts], replies:[txt] }.
--   Persiste reinicios del VPS. Idempotente.
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS agent_loop_guard jsonb;
ALTER TABLE contact_memory ADD COLUMN IF NOT EXISTS loop_guard_state jsonb;

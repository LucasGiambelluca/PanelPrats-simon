# Panel WhatsApp Multi-Cuenta

Monorepo: `server/` (backend Node/Express + Baileys + FlowEngine), `client/` (React+Vite bot builder + inbox), `supabase/` (migraciones).

## Setup
1. Crear proyecto Supabase. Aplicar `supabase/migrations/0001_init_multicuenta.sql` en el SQL Editor.
2. Backend: `cd server && cp .env.example .env` (completar SUPABASE_URL, SUPABASE_SERVICE_KEY, REDIS_URL). `npm install && npm run dev`.
3. Frontend: `cd client && cp .env.example .env` (completar VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY). `npm install && npm run dev`.
4. Redis local: `docker run -p 6379:6379 redis` o instalar Redis.

## Tests
- Backend: `cd server && npm test`

Diseño: `docs/superpowers/specs/2026-06-14-panel-whatsapp-multicuenta-design.md`

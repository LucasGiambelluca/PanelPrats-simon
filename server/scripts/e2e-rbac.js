#!/usr/bin/env node
/**
 * E2E del RBAC contra un server corriendo + Supabase real.
 * Admin (dev-token) crea una empleada; la empleada loguea por Supabase Auth y se
 * verifican sus permisos. Limpia el usuario de prueba al final (delete directo).
 *
 * Requiere: server corriendo con DEV_AUTH_BYPASS=1 en E2E_PORT (default 3011),
 * y SUPABASE_URL + SUPABASE_SERVICE_KEY en .env.
 *
 * Uso: E2E_PORT=3011 node scripts/e2e-rbac.js
 */
require('dotenv').config();
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');

const BASE = `http://localhost:${process.env.E2E_PORT || 3011}`;
const SUP_URL = process.env.SUPABASE_URL;
const SUP_KEY = process.env.SUPABASE_SERVICE_KEY;
const EMAIL = 'e2e-empleada@example.com';
const PASS = 'Empleada123!';

const admin = createClient(SUP_URL, SUP_KEY, { auth: { persistSession: false }, realtime: { transport: ws } });

const results = [];
const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail });
const hdr = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

(async () => {
  // 0. sin token => 401
  let r = await fetch(`${BASE}/api/me`);
  check('sin token /api/me => 401', r.status === 401, r.status);

  // 1. admin (dev-token) /api/me
  r = await fetch(`${BASE}/api/me`, { headers: hdr('dev-token') });
  const me = await r.json().catch(() => ({}));
  check('admin /api/me role=admin', r.status === 200 && me.role === 'admin', JSON.stringify(me));

  // pre-limpieza: si quedó el usuario de prueba de una corrida anterior, borrarlo
  const { data: pre } = await admin.auth.admin.listUsers();
  const old = (pre?.users || []).find((u) => u.email === EMAIL);
  if (old) await admin.auth.admin.deleteUser(old.id);

  // 2. admin crea empleada
  r = await fetch(`${BASE}/api/team`, { method: 'POST', headers: hdr('dev-token'), body: JSON.stringify({ email: EMAIL, password: PASS, name: 'E2E Empleada' }) });
  const created = await r.json().catch(() => ({}));
  check('admin crea empleada (role=empleada)', r.status === 200 && created.role === 'empleada', JSON.stringify(created));
  const empId = created.id;

  // 3. admin lista equipo => incluye la nueva
  r = await fetch(`${BASE}/api/team`, { headers: hdr('dev-token') });
  const team = await r.json().catch(() => []);
  check('admin lista equipo incluye empleada', r.status === 200 && Array.isArray(team) && team.some((t) => t.id === empId));

  // 4. empleada loguea por Supabase Auth (apikey = service key) => JWT
  r = await fetch(`${SUP_URL}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: SUP_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: EMAIL, password: PASS }) });
  const auth = await r.json().catch(() => ({}));
  const tok = auth.access_token;
  check('empleada login => JWT', !!tok, r.status);

  if (tok) {
    // 5. /api/me role empleada
    r = await fetch(`${BASE}/api/me`, { headers: hdr(tok) });
    const m2 = await r.json().catch(() => ({}));
    check('empleada /api/me role=empleada', r.status === 200 && m2.role === 'empleada', JSON.stringify(m2));

    // 6-8. rutas admin => 403
    r = await fetch(`${BASE}/api/flows?account_id=x`, { headers: hdr(tok) });
    check('empleada /api/flows => 403', r.status === 403, r.status);
    r = await fetch(`${BASE}/api/team`, { headers: hdr(tok) });
    check('empleada /api/team => 403', r.status === 403, r.status);
    r = await fetch(`${BASE}/api/config`, { headers: hdr(tok) });
    check('empleada /api/config => 403', r.status === 403, r.status);
    r = await fetch(`${BASE}/api/accounts`, { method: 'POST', headers: hdr(tok), body: JSON.stringify({ name: 'x' }) });
    check('empleada crear cuenta => 403', r.status === 403, r.status);

    // 9. GET accounts => 200, ve TODAS las líneas del estudio, sin secretos.
    //    Pasamos un user_id UUID válido (la propia empleada) para pasar el gate useSupabase;
    //    el branch empleada ignora el filtro y devuelve todas las cuentas slimmed.
    r = await fetch(`${BASE}/api/accounts?user_id=${empId}`, { headers: hdr(tok) });
    const accs = await r.json().catch(() => []);
    const SECRETS = ['access_token', 'app_secret', 'verify_token', 'qr_code', 'ai_api_key', 'ai_support_prompt'];
    const leak = Array.isArray(accs) && accs.some((a) => SECRETS.some((s) => s in a));
    check('empleada GET accounts => 200', r.status === 200, r.status);
    check('empleada ve líneas del estudio (>=1)', Array.isArray(accs) && accs.length >= 1, `${(accs || []).length} líneas`);
    check('empleada GET accounts SIN secretos', Array.isArray(accs) && !leak, leak ? 'FUGA DE SECRETO' : 'ok');

    // 10. agenda permitida
    r = await fetch(`${BASE}/api/appointments?account_id=fbf99cec-ddc9-4ef2-94d0-8f14d0bcb982`, { headers: hdr(tok) });
    check('empleada GET appointments => 200', r.status === 200, r.status);
  }

  // limpieza: borrar empleada de prueba (auth + profile CASCADE)
  if (empId) await admin.auth.admin.deleteUser(empId);

  console.log('\n== E2E RBAC ==');
  for (const x of results) console.log(`${x.ok ? '✅' : '❌'} ${x.name}${x.detail !== undefined ? `  [${x.detail}]` : ''}`);
  const failed = results.filter((x) => !x.ok).length;
  console.log(`\n${failed ? `❌ ${failed} fallo(s)` : '✅ todo verde'}`);
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error('e2e error:', e.message); process.exit(1); });

/**
 * One-off: migra cuentas + flows de memory_store.json a Supabase,
 * preservando los mismos UUIDs y reasignando user_id al usuario auth real.
 *
 * Uso: node scripts/migrate-memory-to-supabase.js <USER_UUID>
 */
require('dotenv/config');
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const USER_ID = process.argv[2];
if (!USER_ID) { console.error('Falta USER_UUID como argumento'); process.exit(1); }

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false },
  realtime: { transport: ws },
});

const store = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../memory_store.json'), 'utf-8'));
const accounts = (store.accounts || []).map(([, a]) => a);
const flows = (store.flows || []).map(([, f]) => f);

(async () => {
  // 1. Cuentas con flow_id=null (rompe la FK circular accounts.flow_id -> flows.id)
  for (const a of accounts) {
    const row = {
      id: a.id,
      user_id: USER_ID,
      name: a.name,
      phone_number: a.phone_number ?? null,
      status: 'disconnected',
      channel: a.channel ?? 'whatsapp',
      provider: a.provider ?? 'baileys',
      flow_id: null,
      external_id: a.external_id ?? null,
      access_token: a.access_token ?? null,
      app_secret: a.app_secret ?? null,
      verify_token: a.verify_token ?? null,
    };
    const { error } = await supabase.from('accounts').upsert(row, { onConflict: 'id' });
    console.log(error ? `❌ account ${a.name}: ${error.message}` : `✅ account ${a.name} (${a.id})`);
  }

  // 2. Flows (account_id preservado)
  for (const f of flows) {
    const row = {
      id: f.id,
      account_id: f.account_id,
      name: f.name,
      trigger_word: f.trigger_word ?? null,
      nodes: f.nodes ?? [],
      edges: f.edges ?? [],
      is_active: f.is_active ?? true,
    };
    const { error } = await supabase.from('flows').upsert(row, { onConflict: 'id' });
    console.log(error ? `❌ flow ${f.name}: ${error.message}` : `✅ flow ${f.name} (${f.id})`);
  }

  // 3. Re-vincular accounts.flow_id ahora que los flows existen
  for (const a of accounts) {
    if (!a.flow_id) continue;
    const { error } = await supabase.from('accounts').update({ flow_id: a.flow_id }).eq('id', a.id);
    console.log(error ? `❌ link ${a.name}->${a.flow_id}: ${error.message}` : `🔗 ${a.name} -> flow ${a.flow_id}`);
  }

  console.log('\nMigración terminada.');
})().catch(e => { console.error(e); process.exit(1); });

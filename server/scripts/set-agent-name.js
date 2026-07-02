// One-off: unifica la identidad del agente con el libreto (Sofía → Estela).
// Solo toca cuentas cuyos procedimientos nombran a Estela. Uso: node scripts/set-agent-name.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });

(async () => {
  const { data, error } = await supabase
    .from('accounts')
    .update({ agent_name: 'Estela' })
    .ilike('agent_procedures', '%Estela%')
    .neq('agent_name', 'Estela')
    .select('id, name, agent_name');
  if (error) { console.error('ERROR:', error); process.exit(1); }
  console.log(`actualizadas: ${data.length}`);
  for (const a of data) console.log(` - ${a.name} (${a.id}) → ${a.agent_name}`);
})();

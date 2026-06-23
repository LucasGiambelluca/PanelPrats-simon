// Auditoría read-only del esquema real (Supabase cloud) vs migraciones 0001-0017.
// Sondea vía PostgREST (SUPABASE_URL + SERVICE_KEY): select(col).limit(1).
//  - 42703 columna ausente | 42P01 tabla ausente | sin error -> presente.
// Índices/funciones/triggers NO son verificables por REST -> se listan aparte.
// Uso: node scripts/db-audit.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }

const supabase = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });

// Marcadores tabla->columna (probe REST). Para "tabla existe" uso una col garantizada o 'id'.
const CHECKS = {
  '0001_init_multicuenta': {
    accounts: ['id'], flows: ['id'], flow_executions: ['id'], flow_executions_history: ['id'],
    whatsapp_conversations: ['id'], whatsapp_messages: ['id'], flow_logs: ['id'],
    audit_logs: ['id'], reports: ['id'], appointments: ['id'],
  },
  '0003_channels': { accounts: ['channel', 'external_id', 'access_token'], whatsapp_messages: ['channel'] },
  '0004_account_provider_and_flow': { accounts: ['provider', 'flow_id'] },
  '0005_flow_executions_missing_cols': { flow_executions: ['updated_at', 'archived_reason'] },
  '0006_account_reminder_minutes': { accounts: ['reminder_minutes'] },
  '0007_appointment_status_lifecycle': { appointments: ['status'] },
  '0008_account_ai_support': { accounts: ['ai_support_enabled', 'ai_api_key', 'ai_model', 'ai_support_prompt'] },
  '0009_salas': { salas: ['id'], invitaciones: ['id'] },
  '0010_profiles': { profiles: ['id', 'role', 'name', 'active'] },
  '0013_account_business_context': { accounts: ['business_context'] },
  '0015_agent_runtime': {
    contact_memory: ['account_id', 'phone'], account_faqs: ['id'],
    accounts: ['agent_mode', 'agent_name', 'agent_persona'],
  },
  '0016_account_offices': { account_offices: ['id', 'capacidad', 'direccion', 'video_link'] },
  '0017_office_capacity': { appointments: ['oficina'] }, // function/trigger -> no REST
  '0018_office_professionals': { office_professionals: ['office_id', 'profile_id', 'activa'] },
  '0019_professional_availability': { professional_availability: ['id', 'profile_id', 'office_id', 'dia', 'hora_inicio', 'hora_fin'] },
  '0020_professional_blocks': { professional_blocks: ['id', 'profile_id', 'office_id', 'start_time', 'end_time'] },
  '0021_appointment_assigned_professional': { appointments: ['assigned_profile_id'] },
};

// No verificables por REST (necesitan acceso SQL directo):
const NO_REST = {
  '0014_webhook_idempotency': 'unique index uq_wamsg_wa_message_id (whatsapp_messages.wa_message_id)',
  '0017_office_capacity': 'function check_office_capacity + trigger trg_office_capacity',
  '0012_appointment_no_overlap': 'constraint appointments_no_overlap (REEMPLAZADO por 0017)',
  '0021_appointment_assigned_professional': 'function check_office_capacity (reescrita: no-overlap por profesional + fallback fija) + trigger trg_office_capacity',
};

async function probe(table, column) {
  const { error } = await supabase.from(table).select(column).limit(1);
  if (!error) return 'ok';
  const code = error.code; const msg = (error.message || '').toLowerCase();
  if (code === '42703' || (msg.includes('column') && msg.includes('does not exist'))) return 'missing-col';
  if (code === '42P01' || (msg.includes('relation') && msg.includes('does not exist'))) return 'missing-table';
  return `err:${error.message}`;
}

(async () => {
  console.log('== Auditoría migraciones (Supabase cloud, vía REST) ==\n');
  let allOk = true;
  for (const [mig, tableCols] of Object.entries(CHECKS)) {
    const missing = [];
    for (const [table, cols] of Object.entries(tableCols)) {
      for (const c of cols) {
        const r = await probe(table, c);
        if (r === 'missing-table') { missing.push(`${table}(tabla ausente)`); break; }
        if (r === 'missing-col') missing.push(`${table}.${c}`);
        else if (r !== 'ok') missing.push(`${table}.${c}[${r}]`);
      }
    }
    if (missing.length === 0) console.log(`  OK    ${mig}`);
    else { allOk = false; console.log(`  FALTA ${mig} -> ${[...new Set(missing)].join(', ')}`); }
  }
  console.log('\n-- No verificables por REST (requieren SQL directo) --');
  for (const [mig, what] of Object.entries(NO_REST)) console.log(`  ?     ${mig}: ${what}`);
  console.log(`\n${allOk ? 'RESULTADO: todo lo verificable por REST está aplicado.' : 'RESULTADO: faltan migraciones (ver FALTA).'}`);
})().catch(e => { console.error('Fallo:', e.message); process.exit(1); });

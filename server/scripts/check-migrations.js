#!/usr/bin/env node
/**
 * Chequea (read-only) qué migraciones están aplicadas en el Supabase real,
 * sondeando columnas vía PostgREST (supabase-js). No modifica nada.
 *
 * Para cada columna marcadora hace `select(col).limit(1)`:
 *  - error 42703 (undefined_column) → columna ausente → migración sin aplicar.
 *  - error 42P01 (undefined_table)  → tabla ausente.
 *  - sin error                      → columna presente.
 *
 * Uso:  node scripts/check-migrations.js
 * Requiere SUPABASE_URL + SUPABASE_SERVICE_KEY en .env.
 */
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;

if (!url || !key || url.includes('TUPROYECTO') || key.includes('...')) {
  console.error('ERROR: SUPABASE_URL / SUPABASE_SERVICE_KEY no configurados (o placeholders) en .env');
  process.exit(1);
}

const supabase = createClient(url, key, {
  auth: { persistSession: false },
  // Node < 22 no trae WebSocket global; supabase-realtime necesita transport explícito.
  realtime: { transport: ws },
});

// Marcadores por migración: { tabla: [columnas] }.
const CHECKS = {
  '0003_channels': {
    accounts: ['channel', 'external_id', 'access_token', 'app_secret', 'verify_token'],
    whatsapp_conversations: ['channel'],
    whatsapp_messages: ['channel'],
  },
  '0004_account_provider_and_flow': { accounts: ['provider', 'flow_id'] },
  '0006_account_reminder_minutes': { accounts: ['reminder_minutes'] },
  '0007_appointment_status_lifecycle': { appointments: ['status'] },
  '0008_account_ai_support': {
    accounts: ['ai_support_enabled', 'ai_api_key', 'ai_model', 'ai_support_prompt'],
  },
  '0009_profiles': { profiles: ['id', 'role', 'name', 'active'] },
};

// Devuelve 'ok' | 'missing-col' | 'missing-table' | 'error'.
async function probe(table, column) {
  const { error } = await supabase.from(table).select(column).limit(1);
  if (!error) return 'ok';
  const code = error.code;
  const msg = (error.message || '').toLowerCase();
  if (code === '42703' || msg.includes('does not exist') && msg.includes('column')) return 'missing-col';
  if (code === '42P01' || msg.includes('does not exist') && msg.includes('relation')) return 'missing-table';
  return `error: ${error.message}`;
}

async function main() {
  console.log('== Estado de migraciones (Supabase real) ==\n');
  let allOk = true;

  for (const [mig, tableCols] of Object.entries(CHECKS)) {
    const missing = [];
    for (const [table, cols] of Object.entries(tableCols)) {
      for (const c of cols) {
        const r = await probe(table, c);
        if (r === 'missing-table') { missing.push(`${table} (tabla ausente)`); break; }
        if (r === 'missing-col') missing.push(`${table}.${c}`);
        else if (r !== 'ok') missing.push(`${table}.${c} [${r}]`);
      }
    }
    if (missing.length === 0) {
      console.log(`  ✅ ${mig}`);
    } else {
      allOk = false;
      console.log(`  ❌ ${mig}  → falta: ${[...new Set(missing)].join(', ')}`);
    }
  }

  console.log(`\n${allOk ? '✅ Todo aplicado.' : '⚠️  Hay migraciones sin aplicar (ver arriba). Aplicá el .sql correspondiente en Supabase SQL Editor.'}`);
}

main().catch(err => { console.error('Fallo:', err.message); process.exit(1); });

// Merge de conversaciones partidas por @lid → teléfono real.
// WhatsApp entrega algunos inbound como <id>@lid (privacidad); cuando senderPn no
// vino, esos mensajes quedaron en una conversación separada del número real, duplicando
// el contacto en el inbox. Este script reunifica.
//
// Estrategia de mapeo lid→phone (conservadora):
//   - Toma pares (fila @lid) + (fila número real 54...) que comparten el MISMO
//     contact_name no vacío → lid := dígitos del @lid, phone := número real.
//   - Reasigna mensajes de la conversación @lid (y de la fila "lid pelado" sin sufijo,
//     si existe) a la conversación real, actualiza metadata y borra las filas @lid/pelado.
//   - Filas @lid SIN match por nombre: NO se tocan (se reportan para revisión manual).
//
// Uso:
//   node scripts/merge-lid-conversations.js            (DRY RUN: solo reporta + backup)
//   node scripts/merge-lid-conversations.js --execute   (aplica los merges)
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const EXECUTE = process.argv.includes('--execute');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
  auth: { persistSession: false }, realtime: { transport: ws },
});

const digits = (p) => (p || '').replace(/[^0-9]/g, '');
const isLid = (p) => (p || '').includes('@lid');
const isRealAr = (p) => { const d = digits(p); return !isLid(p) && d.startsWith('54') && d.length === 12; };

(async () => {
  const { data: convs, error } = await sb
    .from('whatsapp_conversations')
    .select('id, account_id, phone, contact_name, last_message, last_message_at, unread_count, status')
    .limit(2000);
  if (error) { console.error('query error:', error.message); process.exit(1); }

  // 1) mapa lid(dígitos) → { phone real, targetConv } por contact_name compartido, por cuenta.
  const byAcctName = new Map(); // key acct|name → { lid: [], real: [] }
  for (const c of convs) {
    const name = (c.contact_name || '').trim().toLowerCase();
    if (!name) continue;
    const k = c.account_id + '|' + name;
    if (!byAcctName.has(k)) byAcctName.set(k, { lid: [], real: [] });
    if (isLid(c.phone)) byAcctName.get(k).lid.push(c);
    else if (isRealAr(c.phone)) byAcctName.get(k).real.push(c);
  }
  const lidToReal = new Map(); // acct|lidDigits → targetConv
  for (const [, grp] of byAcctName) {
    if (grp.lid.length && grp.real.length === 1) {
      const target = grp.real[0];
      for (const l of grp.lid) lidToReal.set(l.account_id + '|' + digits(l.phone), target);
    }
  }

  // 2) conversaciones a fusionar: cualquier fila cuyo phone sea <lid>@lid o <lid> pelado
  //    cuyo lidDigits esté mapeado, y que NO sea ya la fila target.
  const merges = []; // { from: conv, to: conv }
  for (const c of convs) {
    const lidKey = c.account_id + '|' + digits(c.phone);
    const target = lidToReal.get(lidKey);
    if (!target) continue;
    if (c.id === target.id) continue;
    if (isRealAr(c.phone)) continue; // no fusionar números reales entre sí
    merges.push({ from: c, to: target });
  }

  // reporte
  console.log(`\n=== MERGE @lid → teléfono real (${EXECUTE ? 'EXECUTE' : 'DRY RUN'}) ===`);
  console.log(`conversaciones totales: ${convs.length}`);
  console.log(`mapeos lid→real detectados (por contact_name): ${lidToReal.size}`);
  for (const [k, t] of lidToReal) console.log(`   ${k}  →  ${t.phone} (${t.contact_name})`);
  console.log(`\nfusiones propuestas: ${merges.length}`);
  for (const m of merges) console.log(`   "${m.from.contact_name || 's/n'}" ${m.from.phone} (conv ${m.from.id.slice(0,8)}) → ${m.to.phone} (conv ${m.to.id.slice(0,8)})`);

  const lidNoMatch = convs.filter((c) => isLid(c.phone) && !lidToReal.get(c.account_id + '|' + digits(c.phone)));
  if (lidNoMatch.length) {
    console.log(`\n@lid SIN match por nombre (NO se tocan — revisar manual): ${lidNoMatch.length}`);
    for (const c of lidNoMatch) console.log(`   ${c.phone} (${c.contact_name || 's/n'})`);
  }

  if (!merges.length) { console.log('\nNada para fusionar.'); return; }

  // backup siempre (incluso dry-run): filas afectadas + sus mensajes (ids).
  const affectedConvIds = merges.map((m) => m.from.id);
  const { data: affMsgs } = await sb.from('whatsapp_messages').select('id, conversation_id, phone').in('conversation_id', affectedConvIds);
  const backup = { generatedAt: new Date().toISOString(), merges: merges.map((m) => ({ from: m.from, to: { id: m.to.id, phone: m.to.phone } })), messages: affMsgs ?? [] };
  const backupPath = path.join(__dirname, `_merge-lid-backup-${Date.now()}.json`);
  fs.writeFileSync(backupPath, JSON.stringify(backup, null, 2));
  console.log(`\nbackup escrito: ${backupPath} (${(affMsgs ?? []).length} mensajes afectados)`);

  if (!EXECUTE) { console.log('\nDRY RUN — no se aplicó nada. Re-correr con --execute para fusionar.'); return; }

  // 3) aplicar: por cada merge, reasignar mensajes → target, mergear metadata, borrar fila origen.
  for (const m of merges) {
    const { error: upErr } = await sb.from('whatsapp_messages')
      .update({ conversation_id: m.to.id, phone: m.to.phone })
      .eq('conversation_id', m.from.id);
    if (upErr) { console.error(`  ERROR reasignando msgs de ${m.from.id}:`, upErr.message); continue; }

    // metadata: conservar el last_message más reciente entre ambas.
    const fromAt = m.from.last_message_at ? new Date(m.from.last_message_at).getTime() : 0;
    const toAt = m.to.last_message_at ? new Date(m.to.last_message_at).getTime() : 0;
    const patch = {};
    if (fromAt > toAt) { patch.last_message = m.from.last_message; patch.last_message_at = m.from.last_message_at; }
    patch.unread_count = (m.to.unread_count || 0) + (m.from.unread_count || 0);
    if (Object.keys(patch).length) await sb.from('whatsapp_conversations').update(patch).eq('id', m.to.id);

    const { error: delErr } = await sb.from('whatsapp_conversations').delete().eq('id', m.from.id);
    if (delErr) { console.error(`  ERROR borrando conv ${m.from.id}:`, delErr.message); continue; }
    console.log(`  OK fusionado ${m.from.phone} → ${m.to.phone}`);
  }
  console.log('\nMerge aplicado. Verificá el inbox.');
})().catch((e) => { console.error('Fallo:', e.message); process.exit(1); });

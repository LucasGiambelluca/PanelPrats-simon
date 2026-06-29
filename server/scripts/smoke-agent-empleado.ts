// Smoke CONVERSACIONAL de las 4 capacidades (requiere LLM con saldo: OpenAI/Groq).
// Persiste cada turno en whatsapp_messages para que el agente tenga historial real
// (continuidad + multi-turno coherente) y limpia TODO al final (DB es prod).
//
//   Uso: SMOKE_ACCOUNT_ID=<cuenta real> npx ts-node scripts/smoke-agent-empleado.ts
import 'dotenv/config';
import { getAgentRuntime } from '../src/core/agent/runtime/createAgentRuntime';
import { MessageStore } from '../src/services/MessageStore';
import { supabase } from '../src/config/supabase';
import { redisPersistence } from '../src/infrastructure/persistence/RedisPersistenceService';

const ACC = process.env.SMOKE_ACCOUNT_ID || '49463422-5221-4550-baba-c79abe1d4728';
const PHONE = '541100000099'; // ya normalizado (como lo guarda WhatsAppClient) → getHistory matchea
const store = new MessageStore();

// Guion: indicaciones vagas de adulto mayor. El LLM dispara start_booking (1 vez);
// el resto lo conduce el flujo determinístico (BookingFlow), turno a turno.
const GUION = [
  'buenas, ando necesitando un turno por mi jubilación, prefiero ir en persona', // → start_booking(presencial)
  'soy de Lanús, cerca de la estación',          // ask_zone → suggest_office ≈ Quilmes → muestra slots
  'deme el primerito',                            // await_slot → pick_option
  'Juan',                                         // ask_name
  'sí, dale, confirmo',                           // confirm → book + ficha IA
];

async function persist(direction: 'INBOUND' | 'OUTBOUND', content: string) {
  const convId = await store.upsertConversation(ACC, PHONE, 'SMOKE Empleado', content);
  await store.insertMessage(convId, { accountId: ACC, phone: PHONE, direction, content });
}

async function teardown() {
  await supabase.from('appointments').delete().eq('phone', PHONE);
  await supabase.from('whatsapp_messages').delete().eq('phone', PHONE);
  await supabase.from('whatsapp_conversations').delete().eq('account_id', ACC).eq('phone', PHONE);
  await supabase.from('contact_memory').delete().eq('phone', PHONE);
  console.log('\n🧹 datos de prueba eliminados (DB limpia)');
}

(async () => {
  const rt = getAgentRuntime();
  // Reset de estado efímero (booking + opciones) de corridas previas.
  await redisPersistence.setRaw(`booking:${ACC}:${PHONE}`, '', 1);
  await redisPersistence.setRaw(`offered:${ACC}:${PHONE}`, '', 1);
  try {
    for (const msg of GUION) {
      console.log(`\n👤 Cliente: ${msg}`);
      await persist('INBOUND', msg);
      const out = await rt.handle(ACC, PHONE, msg, {});
      for (const r of out) { console.log(`🤖 Sofía: ${r}`); await persist('OUTBOUND', r); }
    }

    // Verificación final: ¿quedó cita con ficha IA?
    const { data: appts } = await supabase.from('appointments')
      .select('nombre, oficina, resumen_ia, perfil_json, start_time').eq('phone', PHONE);
    console.log('\n📋 Citas creadas en el guion:', JSON.stringify(appts, null, 2));
  } catch (e: any) {
    console.log('❌ error en el guion:', e?.message ?? e);
  } finally {
    await teardown();
    process.exit(0);
  }
})();

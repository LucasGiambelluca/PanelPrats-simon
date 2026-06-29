// Smoke test del agente IA-primero: llama getAgentRuntime().handle() directo,
// sin pasar por WhatsApp. Usa OpenAI real + Supabase real (vía supabase-js).
// Cuenta/teléfono de PRUEBA (no afecta ninguna línea real).
//   Uso: npx ts-node scripts/smoke-agent.ts
import 'dotenv/config';
import { getAgentRuntime } from '../src/core/agent/runtime/createAgentRuntime';

const ACCOUNT = process.env.SMOKE_ACCOUNT_ID || '00000000-0000-0000-0000-0000000000aa';
const PHONE = process.env.SMOKE_PHONE || '5490000000000';

const MENSAJES = [
  'hola! necesito ayuda con mi jubilación',
  '¿cuánto sale una consulta y dónde quedan?',
  'me podés dar un turno para la semana que viene?',
];

(async () => {
  const rt = getAgentRuntime();
  for (const msg of MENSAJES) {
    console.log(`\n👤 Cliente: ${msg}`);
    try {
      const out = await rt.handle(ACCOUNT, PHONE, msg, {});
      for (const r of out) console.log(`🤖 Sofía: ${r}`);
    } catch (e: any) {
      console.log(`❌ error: ${e?.message ?? e}`);
    }
  }
  console.log('\n--- fin smoke ---');
  process.exit(0);
})();

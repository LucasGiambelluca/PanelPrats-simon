import 'dotenv/config';
import { FlowEngine } from '../src/core/engine/flow.engine';
import { ConversationRouter } from '../src/core/engine/conversation.router';

const ACCOUNT = 'fbf99cec-ddc9-4ef2-94d0-8f14d0bcb982';

const engine = new FlowEngine();
const router = new ConversationRouter(engine);

function fmt(res: any[]): string {
  return (res || []).map(r => typeof r === 'string' ? r : JSON.stringify(r)).join(' ⏎ ').replace(/\n/g, ' ');
}

async function send(phone: string, text: string): Promise<string> {
  const res = await router.processMessage(ACCOUNT, phone, text, 'TestUser', {});
  return fmt(res);
}

async function main() {
  // 1) Chequeo rápido de cada opción del menú (sesión nueva por teléfono)
  console.log('===== RUTEO DEL MENÚ =====');
  const labels = ['1 Jubilación', '2 Pensión', '3 Despido', '4 Accidente', '5 Otra', '6 Ya cliente'];
  for (let i = 1; i <= 6; i++) {
    const phone = `99900000${i}`;
    await engine.forceReset(ACCOUNT, phone);
    const menu = await send(phone, 'hola');
    const pick = await send(phone, String(i));
    console.log(`\n[opción ${labels[i - 1]}]`);
    console.log('  hola →', menu.slice(0, 90));
    console.log(`  "${i}" →`, pick.slice(0, 140));
  }

  // 2) Walkthrough completo de Despido (option 3) hasta agendar
  console.log('\n\n===== WALKTHROUGH DESPIDO (end-to-end) =====');
  const P = '999111222';
  await engine.forceReset(ACCOUNT, P);
  const steps = ['hola', '3', 'Juan Perez', '1', '1', 'Me despidieron sin causa el mes pasado de la empresa ACME', '1'];
  for (const s of steps) {
    const r = await send(P, s);
    console.log(`\n>>> "${s}"`);
    console.log('  BOT:', r.slice(0, 220));
  }

  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });

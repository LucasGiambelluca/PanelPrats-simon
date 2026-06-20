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
  // NUEVO FLUJO DE ENTRADA (post seed-entrada-humana.js):
  // El primer mensaje del usuario llega al nodo r_welcome (questionNode, route_by_ai: true).
  // La IA (SupportAgentService) decide:
  //   - 'route'   → redirige al flujo correspondiente (no muestra el menú de botones)
  //   - 'answer'  → responde en rol y avanza al menú de botones (r_menu) como respaldo
  //   - 'handoff' → deriva a humano
  //   - 'none'    → cae al menú de botones (r_menu)

  // 1) Verificación de ruteo por IA: mensaje libre → Despido
  //    Se espera que la IA identifique "me echaron del trabajo" y rutee al flujo Despido.
  console.log('===== RUTEO IA: saludo libre + texto libre =====');
  {
    const phone = '999000001';
    await engine.forceReset(ACCOUNT, phone);
    // El bot responde con el saludo abierto ("¡Hola! 👋 Contame, ¿en qué te puedo ayudar?")
    const saludo = await send(phone, 'hola');
    console.log('\n[saludo abierto]');
    console.log('  "hola" →', saludo.slice(0, 120));

    // Respuesta libre: la IA debería rutear a Despido/ART.
    // Resultado esperado: el motor retoma el flujo Despido desde su nodo de bienvenida.
    const ruta = await send(phone, 'me echaron del trabajo');
    console.log('\n[text libre → espera ruteo a Despido]');
    console.log('  "me echaron del trabajo" →', ruta.slice(0, 220));
  }

  // 2) Pregunta general: responde "answer" o deriva a humano (según business_context cargado)
  //    Ejemplo: pregunta por horarios del estudio.
  console.log('\n\n===== RUTEO IA: pregunta general (answer o handoff) =====');
  {
    const phone = '999000002';
    await engine.forceReset(ACCOUNT, phone);
    const saludo = await send(phone, 'hola');
    console.log('\n[saludo abierto]');
    console.log('  "hola" →', saludo.slice(0, 120));

    // La IA evalúa si puede responder con business_context.
    // Si hay contexto cargado: action='answer' → responde + muestra menú.
    // Si no hay contexto: action='handoff' → deriva a humano.
    const resp = await send(phone, '¿atienden los sábados?');
    console.log('\n[pregunta general → answer o handoff + menú respaldo]');
    console.log('  "¿atienden los sábados?" →', resp.slice(0, 220));
  }

  // 3) Chequeo de cada opción del menú de botones (respaldo / fallback manual)
  //    Si el usuario no dice nada reconocible, el menú igual aparece.
  console.log('\n\n===== MENÚ DE BOTONES (respaldo) =====');
  const labels = ['1 Jubilación', '2 Pensión', '3 Despido', '4 Accidente', '5 Otra', '6 Ya cliente'];
  for (let i = 1; i <= 6; i++) {
    const phone = `99900000${i + 10}`;
    await engine.forceReset(ACCOUNT, phone);
    // El usuario dice "hola" → saludo abierto
    const saludo = await send(phone, 'hola');
    // Texto sin sentido → la IA no rutea → muestra el menú de botones
    const menu = await send(phone, 'mmm');
    // El usuario elige una opción del menú
    const pick = await send(phone, String(i));
    console.log(`\n[opción ${labels[i - 1]}]`);
    console.log('  "hola" →', saludo.slice(0, 90));
    console.log('  "mmm"  →', menu.slice(0, 90));
    console.log(`  "${i}"  →`, pick.slice(0, 140));
  }

  // 4) Walkthrough completo de Despido vía IA (end-to-end)
  //    El usuario declara su situación directamente en el primer mensaje libre.
  console.log('\n\n===== WALKTHROUGH DESPIDO por IA (end-to-end) =====');
  {
    const P = '999111222';
    await engine.forceReset(ACCOUNT, P);
    // La IA rutea 'me echaron' → flujo Despido directamente desde el saludo.
    const steps = ['hola', 'me echaron del trabajo sin causa', 'Juan Perez', '1', '1', 'Me despidieron sin causa el mes pasado de la empresa ACME', '1'];
    for (const s of steps) {
      const r = await send(P, s);
      console.log(`\n>>> "${s}"`);
      console.log('  BOT:', r.slice(0, 220));
    }
  }

  process.exit(0);
}
main().catch(e => { console.error('ERR', e); process.exit(1); });

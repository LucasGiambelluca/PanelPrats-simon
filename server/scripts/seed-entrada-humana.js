/**
 * seed-entrada-humana.js
 *
 * Parcha el flujo wildcard "Router Consultas" (trigger_word = "*") para que su
 * nodo de bienvenida sea un questionNode abierto con route_by_ai: true.
 *
 * La IA (SupportAgentService) intenta rutear al flujo correcto en función del
 * texto libre. Si responde 'answer', el mensaje se envía y se avanza al menú
 * de botones que ya existe (r_menu). Si responde 'none' también cae al menú.
 *
 * {{nombre}} es resuelto por el helper `interpolate` del motor: si el usuario
 * no tiene pushName el saludo queda "¡Hola! 👋 Contame…" (fallback automático).
 *
 * Uso:
 *   node scripts/seed-entrada-humana.js <ACCOUNT_ID> [API_URL]
 *
 * Ejemplo:
 *   node scripts/seed-entrada-humana.js fbf99cec-ddc9-4ef2-94d0-8f14d0bcb982
 *
 * ASSUMPTIONS:
 *   - Endpoint de lista: GET ${API}/api/flows?account_id=<id>  → array de flujos
 *   - Endpoint de actualización: PUT ${API}/api/flows/:id con { nodes, edges }
 *   - El flujo wildcard es el único cuyo trigger_word contiene "*".
 *   - El nodo de bienvenida tiene id "r_welcome" (creado por seed-router-despido.js).
 */

const ACCOUNT_ID = process.argv[2];
const API = process.argv[3] || 'http://localhost:3001';

if (!ACCOUNT_ID) {
  console.error('Uso: node scripts/seed-entrada-humana.js <ACCOUNT_ID> [API_URL]');
  process.exit(1);
}

async function getFlows() {
  const res = await fetch(`${API}/api/flows?account_id=${ACCOUNT_ID}`);
  if (!res.ok) {
    console.error(`❌ GET /api/flows falló: ${res.status}`);
    process.exit(1);
  }
  return res.json();
}

async function putFlow(flowId, body) {
  const res = await fetch(`${API}/api/flows/${flowId}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    console.error(`❌ PUT /api/flows/${flowId} falló: ${res.status}`, text);
    process.exit(1);
  }
  return res.json();
}

(async () => {
  // 1. Obtener todos los flujos de la cuenta.
  const flows = await getFlows();

  // 2. Localizar el flujo wildcard (trigger_word contiene "*").
  const wildcardFlow = flows.find((f) => {
    if (!f.trigger_word) return false;
    return f.trigger_word.split(',').map((t) => t.trim()).includes('*');
  });

  if (!wildcardFlow) {
    console.error('❌ No se encontró ningún flujo con trigger_word "*". Corré primero seed-router-despido.js.');
    process.exit(1);
  }

  console.log(`✅ Flujo wildcard encontrado: "${wildcardFlow.name}" (id: ${wildcardFlow.id})`);

  const nodes = Array.isArray(wildcardFlow.nodes) ? wildcardFlow.nodes : [];

  // 3. Localizar el nodo de bienvenida (id: r_welcome).
  const welcomeIdx = nodes.findIndex((n) => n.id === 'r_welcome');

  if (welcomeIdx === -1) {
    console.error('❌ No se encontró el nodo r_welcome en el flujo wildcard.');
    process.exit(1);
  }

  const welcomeNode = nodes[welcomeIdx];

  // 4. Verificar idempotencia: si ya es questionNode con route_by_ai, no hacer nada.
  if (
    welcomeNode.type === 'questionNode' &&
    welcomeNode.data?.route_by_ai === true
  ) {
    console.log('ℹ️  El nodo r_welcome ya está configurado como saludo abierto con route_by_ai. Ya aplicado — saliendo sin cambios.');
    process.exit(0);
  }

  // 5. Convertir el nodo de bienvenida al nuevo tipo.
  const updatedWelcomeNode = {
    ...welcomeNode,
    type: 'questionNode',
    data: {
      question: '¡Hola {{nombre}}! 👋 Contame, ¿en qué te puedo ayudar?',
      variable: 'consulta',
      route_by_ai: true,
    },
    // Mantener posición original.
    position: welcomeNode.position,
  };

  const updatedNodes = [...nodes];
  updatedNodes[welcomeIdx] = updatedWelcomeNode;

  // 6. PATCHear el flujo (las edges existentes r_welcome → r_menu quedan intactas).
  const updated = await putFlow(wildcardFlow.id, {
    nodes: updatedNodes,
    edges: wildcardFlow.edges,
  });

  console.log(`✅ Flujo "${wildcardFlow.name}" actualizado. Nodo r_welcome ahora es questionNode con route_by_ai.`);
  console.log('   El flujo de entrada queda:');
  console.log('   usuario escribe libremente → IA rutea/responde → (si answer/none) muestra menú de botones (r_menu).');
  console.log('\nListo.');
})().catch((e) => {
  console.error('Error fatal:', e);
  process.exit(1);
});

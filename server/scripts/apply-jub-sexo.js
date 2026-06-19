/**
 * Flujo "Router de Entrada": inferencia de sexo por nombre.
 *   menu(jubilación) -> q_nombre_sexo (IntentResolver IA)
 * El engine avanza desde un intentResolverNode usando el VALOR CLASIFICADO como
 * sourceHandle del edge (es un nodo branching, no acepta edge sin handle).
 * Por eso NO se usa switchNode: se cablean los edges directo por handle:
 *   mujer  -> Jubilación Mujer
 *   hombre -> Jubilación Hombre
 *   handover/error (ambiguo o falla IA) -> poll 'genero' (fallback explícito)
 * Idempotente y autocorrige un intento previo con switchNode mal cableado.
 */
require('dotenv').config();
const ws = require('ws');
const { createClient } = require('@supabase/supabase-js');
const s = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false }, realtime: { transport: ws } });

const FLOW_ID = '88604794-895c-4047-80fb-27aa7dbd6f52';
const LINK_JUBM = 'link_jubm';
const LINK_JUBH = 'link_jubh';

(async () => {
  const { data: flow, error } = await s.from('flows').select('nodes,edges').eq('id', FLOW_ID).single();
  if (error) { console.log('ERROR fetch:', error.message); process.exit(1); }

  let nodes = flow.nodes || [];
  let edges = flow.edges || [];

  // 1) Asegurar el nodo intentResolver (crear si falta).
  if (!nodes.some(n => n.id === 'q_nombre_sexo')) {
    nodes.push({
      id: 'q_nombre_sexo',
      type: 'intentResolverNode',
      position: { x: -560, y: 300 },
      data: {
        question: 'Perfecto 👍 ¿A nombre de quién hacemos la consulta? (nombre y apellido)',
        possible_intents: 'mujer,hombre',
        output_variable: 'sexo',
        system_prompt: "Sos un clasificador. Te dan el NOMBRE de una persona de Argentina. Devolvé SOLO 'mujer' u 'hombre' según el sexo más probable del nombre de pila. Si es unisex, ilegible o no es un nombre, devolvé 'no_entendido'. Sin texto extra.",
        user_prompt: 'Nombre: "{{input}}". Devolvé solo: mujer, hombre o no_entendido.',
        max_retries: 1,
        fallback_message: 'Para asegurarme te lo pregunto acá abajo 👇',
      },
    });
  }

  // 2) Sacar el switchNode mal cableado del intento anterior (si existe).
  nodes = nodes.filter(n => n.id !== 'sw_sexo');
  edges = edges.filter(e => !['e_q_sw', 'e_sw_m', 'e_sw_h', 'e_sw_amb'].includes(e.id));

  // 3) menu(option-0) -> q_nombre_sexo
  const eJub = edges.find(e => e.id === 'e_m_jub');
  if (eJub) eJub.target = 'q_nombre_sexo';
  else edges.push({ id: 'e_m_jub', source: 'menu', target: 'q_nombre_sexo', sourceHandle: 'option-0' });

  // 4) Edges del intentResolver POR HANDLE (= valor clasificado).
  const setEdge = (id, target, handle) => {
    edges = edges.filter(e => e.id !== id);
    edges.push({ id, source: 'q_nombre_sexo', target, sourceHandle: handle });
  };
  setEdge('e_qns_mujer', LINK_JUBM, 'mujer');
  setEdge('e_qns_hombre', LINK_JUBH, 'hombre');
  setEdge('e_qns_amb', 'genero', 'handover'); // fail tras max_retries
  setEdge('e_qns_err', 'genero', 'error');    // error de IA

  const { error: upErr } = await s.from('flows').update({ nodes, edges, updated_at: new Date().toISOString() }).eq('id', FLOW_ID);
  if (upErr) { console.log('ERROR update:', upErr.message); process.exit(1); }

  console.log('✅ Reparado. Nodos:', nodes.length, 'Edges:', edges.length);
  console.log('   q_nombre_sexo --mujer--> jubM | --hombre--> jubH | --handover/error--> genero(poll)');
})();

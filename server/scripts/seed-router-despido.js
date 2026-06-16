/**
 * Crea: subflow "Consulta Despido/ART" + "Router Consultas" (menú, catch-all).
 * Linkea el router a Jubilaciones (existente) y a Despido (nuevo) vía flowLinkNode.
 * Pasa Jubilaciones a trigger no-wildcard para que el Router sea la única entrada `*`.
 *
 * Uso: node scripts/seed-router-despido.js <ACCOUNT_ID> <JUBILACIONES_FLOW_ID> [API_URL]
 */
const ACCOUNT_ID = process.argv[2];
const JUBILACIONES_ID = process.argv[3];
const API = process.argv[4] || 'http://localhost:3001';
if (!ACCOUNT_ID || !JUBILACIONES_ID) { console.error('Uso: node ... <ACCOUNT_ID> <JUBILACIONES_FLOW_ID>'); process.exit(1); }

function mkFlow(name, trigger) {
  let y = 0;
  const Y = () => (y += 130);
  return {
    body: { account_id: ACCOUNT_ID, name, trigger_word: trigger, is_active: true, nodes: [], edges: [] },
    node(id, type, data, x = 250) { this.body.nodes.push({ id, type, position: { x, y: Y() }, data }); return this; },
    start() { this.body.nodes.push({ id: 'start', type: 'input', position: { x: 250, y: 0 }, data: { label: 'Inicio' }, style: { background: '#22c55e', color: 'white', border: 'none', fontWeight: 'bold' } }); return this; },
    edge(s, t, h = null) { this.body.edges.push({ id: `e-${s}-${t}-${h || 'd'}`, source: s, target: t, sourceHandle: h, targetHandle: null, animated: true, style: { strokeWidth: 2, stroke: '#6366f1' } }); return this; },
  };
}

async function post(body) {
  const res = await fetch(`${API}/api/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const j = await res.json();
  if (!res.ok) { console.error('❌', res.status, j); process.exit(1); }
  return j;
}

(async () => {
  // ---------- 1) Subflow Despido/ART ----------
  const d = mkFlow('Consulta Despido/ART', 'despido,art,laboral');
  d.start();
  d.node('d_welcome', 'messageNode', { text: '⚖️ Te ayudo con tu consulta *laboral* (despido / ART / trabajo en negro). Unas preguntas rápidas 👇' });
  d.node('d_nombre', 'questionNode', { question: '¿A nombre de quién es la consulta?', variable: 'nombre' });
  d.node('d_situacion', 'pollNode', { question: '¿Cuál es tu situación?', options: ['Me despidieron', 'Renuncié', 'Sigo trabajando', 'Accidente laboral / ART'], variable: 'situacion' });
  d.node('d_registro', 'pollNode', { question: '¿Estabas registrado (en blanco)?', options: ['Sí, en blanco', 'No, en negro', 'Parcialmente'], variable: 'registro' });
  d.node('d_detalle', 'questionNode', { question: 'Contame brevemente qué pasó: empresa, fechas (ingreso/egreso) y lo que recuerdes.', variable: 'resumen' });
  d.node('d_proposals', 'appointmentProposalsNode', {
    startHour: '09:00', endHour: '18:00', allowedDays: [1, 2, 3, 4, 5], slotDuration: 30, maxProposals: 3, outputVariable: 'horarios',
    text: '📅 Estos son los próximos horarios para tu *consulta virtual*:\n\n{{horarios}}',
  });
  d.node('d_choice', 'questionNode', { question: 'Respondé con el *número* de la opción que preferís (1, 2 o 3):', variable: 'opcion_horario' });
  d.node('d_book', 'appointmentNode', {
    nombreVar: 'nombre', telefonoVar: '', resumenVar: 'resumen', slotChoiceVar: 'opcion_horario', slotsVar: 'horarios_array',
    text: '✅ ¡Listo! Tu consulta laboral quedó agendada. Te enviamos el link de la videollamada antes del turno. ¡Gracias!',
  });
  d.edge('start', 'd_welcome').edge('d_welcome', 'd_nombre').edge('d_nombre', 'd_situacion');
  // pollNodes avanzan por cualquier opción al siguiente paso (no ramifican distinto)
  ['option-0', 'option-1', 'option-2', 'option-3'].forEach(h => d.edge('d_situacion', 'd_registro', h));
  ['option-0', 'option-1', 'option-2'].forEach(h => d.edge('d_registro', 'd_detalle', h));
  d.edge('d_detalle', 'd_proposals').edge('d_proposals', 'd_choice').edge('d_choice', 'd_book');

  const despido = await post(d.body);
  console.log('✅ Subflow Despido/ART:', despido.id);

  // ---------- 2) Router Consultas (catch-all) ----------
  const r = mkFlow('Router Consultas', '*');
  r.start();
  r.node('r_welcome', 'messageNode', { text: '👋 ¡Hola! Soy el asistente del *Estudio*. ¿En qué tema necesitás asesoría?' });
  r.node('r_menu', 'pollNode', {
    question: 'Elegí una opción:',
    options: ['Jubilación / ANSES', 'Pensión por viudez', 'Despido / ART / Trabajo en negro', 'Accidente de tránsito', 'Otra consulta (divorcio, familia…)', 'Ya soy cliente'],
    variable: 'motivo',
  });
  r.node('r_link_jub', 'flowLinkNode', { flowId: JUBILACIONES_ID });
  r.node('r_link_desp', 'flowLinkNode', { flowId: despido.id });
  r.node('r_asesor', 'messageNode', { text: '🧑‍⚖️ Un asesor del estudio te va a contactar a la brevedad por este tema. ¡Gracias por escribirnos!' });
  r.edge('start', 'r_welcome').edge('r_welcome', 'r_menu');
  r.edge('r_menu', 'r_link_jub', 'option-0');   // Jubilación
  r.edge('r_menu', 'r_asesor', 'option-1');     // Pensión (aún sin subflow)
  r.edge('r_menu', 'r_link_desp', 'option-2');  // Despido/ART
  r.edge('r_menu', 'r_asesor', 'option-3');     // Accidente
  r.edge('r_menu', 'r_asesor', 'option-4');     // Otra
  r.edge('r_menu', 'r_asesor', 'option-5');     // Ya soy cliente

  const router = await post(r.body);
  console.log('✅ Router Consultas:', router.id);

  // ---------- 3) Jubilaciones deja de ser wildcard ----------
  const put = await fetch(`${API}/api/flows/${JUBILACIONES_ID}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ trigger_word: 'jubilacion' }) });
  console.log(put.ok ? '🔧 Jubilaciones trigger → "jubilacion" (ya no wildcard)' : '⚠️ no se pudo actualizar Jubilaciones');
  console.log('\nListo. Router (*) → menú → Jubilación / Despido / (resto: asesor).');
})().catch(e => { console.error(e); process.exit(1); });

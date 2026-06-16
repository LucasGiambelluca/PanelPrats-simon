/**
 * Crea subflows "Accidente de Tránsito" y "Otra Consulta", y los enlaza desde el
 * Router (opción 4 = option-3, opción 5 = option-4).
 * Uso: node scripts/seed-accidente-otra.js <ACCOUNT_ID> <ROUTER_FLOW_ID> [API_URL]
 */
const ACCOUNT_ID = process.argv[2];
const ROUTER_ID = process.argv[3];
const API = process.argv[4] || 'http://localhost:3001';
if (!ACCOUNT_ID || !ROUTER_ID) { console.error('Uso: node ... <ACCOUNT_ID> <ROUTER_FLOW_ID>'); process.exit(1); }

function builder() {
  let y = 0; const Y = () => (y += 130);
  return {
    nodes: [{ id: 'start', type: 'input', position: { x: 250, y: 0 }, data: { label: 'Inicio' }, style: { background: '#22c55e', color: 'white', border: 'none', fontWeight: 'bold' } }],
    edges: [],
    n(id, type, data) { this.nodes.push({ id, type, position: { x: 250, y: Y() }, data }); return this; },
    e(s, t, h = null) { this.edges.push({ id: `e-${s}-${t}-${h || 'd'}`, source: s, target: t, sourceHandle: h, targetHandle: null, animated: true, style: { strokeWidth: 2, stroke: '#6366f1' } }); return this; },
    poll(id, prev, question, options, variable) { this.n(id, 'pollNode', { question, options, variable }); options.forEach((_, i) => this.e(prev, id, i === 0 ? null : null)); return this; },
  };
}
const proposals = (out = 'horarios') => ({ startHour: '09:00', endHour: '18:00', allowedDays: [1, 2, 3, 4, 5], slotDuration: 30, maxProposals: 3, outputVariable: out, text: '📅 Estos son los próximos horarios para tu *consulta virtual gratuita*:\n\n{{horarios}}' });
const book = (txt) => ({ nombreVar: 'nombre', telefonoVar: '', resumenVar: 'resumen', slotChoiceVar: 'opcion_horario', slotsVar: 'horarios_array', text: txt });

async function post(name, trigger, b) {
  const res = await fetch(`${API}/api/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: ACCOUNT_ID, name, trigger_word: trigger, is_active: true, nodes: b.nodes, edges: b.edges }) });
  const j = await res.json(); if (!res.ok) { console.error('❌', name, j); process.exit(1); }
  return j;
}
function pollEdges(b, src, opts, target) { opts.forEach((_, i) => b.e(src, target, `option-${i}`)); }

(async () => {
  // ---- Accidente de Tránsito ----
  const a = builder();
  a.n('a_welcome', 'messageNode', { text: '🚗 Te ayudo con tu consulta por *accidente de tránsito*. Unas preguntas para tu cita gratuita 👇' });
  a.n('a_nombre', 'questionNode', { question: '¿A nombre de quién es la consulta?', variable: 'nombre' });
  a.n('a_rol', 'pollNode', { question: '¿Qué rol tuviste en el accidente?', options: ['Conductor', 'Acompañante', 'Peatón', 'Ciclista / Moto'], variable: 'rol' });
  a.n('a_lesiones', 'pollNode', { question: '¿Tuviste lesiones?', options: ['Sí, internación/tratamiento', 'Lesiones leves', 'Sin lesiones'], variable: 'lesiones' });
  a.n('a_seguro', 'pollNode', { question: '¿El otro vehículo tenía seguro?', options: ['Sí', 'No', 'No sé'], variable: 'seguro' });
  a.n('a_detalle', 'questionNode', { question: 'Contame cómo fue: fecha, lugar, si hubo denuncia policial y daños.', variable: 'resumen' });
  a.n('a_proposals', 'appointmentProposalsNode', proposals());
  a.n('a_choice', 'questionNode', { question: 'Respondé con el *número* de la opción que preferís (1, 2 o 3):', variable: 'opcion_horario' });
  a.n('a_book', 'appointmentNode', book('✅ ¡Listo! Tu consulta por el accidente quedó agendada. Te enviamos el link de la videollamada antes del turno. ¡Gracias!'));
  a.e('start', 'a_welcome').e('a_welcome', 'a_nombre').e('a_nombre', 'a_rol');
  pollEdges(a, 'a_rol', a.nodes.find(n => n.id === 'a_rol').data.options, 'a_lesiones');
  pollEdges(a, 'a_lesiones', a.nodes.find(n => n.id === 'a_lesiones').data.options, 'a_seguro');
  pollEdges(a, 'a_seguro', a.nodes.find(n => n.id === 'a_seguro').data.options, 'a_detalle');
  a.e('a_detalle', 'a_proposals').e('a_proposals', 'a_choice').e('a_choice', 'a_book');
  const accidente = await post('Consulta Accidente de Tránsito', 'accidente,transito,tránsito,choque,siniestro', a);
  console.log('✅ Accidente:', accidente.id);

  // ---- Otra Consulta ----
  const o = builder();
  o.n('o_welcome', 'messageNode', { text: '⚖️ Te ayudo con tu consulta legal. Unas preguntas para tu cita gratuita 👇' });
  o.n('o_nombre', 'questionNode', { question: '¿A nombre de quién es la consulta?', variable: 'nombre' });
  o.n('o_tema', 'pollNode', { question: '¿Sobre qué tema es tu consulta?', options: ['Divorcio', 'Familia (cuota, tenencia)', 'Sucesión / herencia', 'Otro tema legal'], variable: 'tema' });
  o.n('o_detalle', 'questionNode', { question: 'Contame brevemente tu situación.', variable: 'resumen' });
  o.n('o_proposals', 'appointmentProposalsNode', proposals());
  o.n('o_choice', 'questionNode', { question: 'Respondé con el *número* de la opción que preferís (1, 2 o 3):', variable: 'opcion_horario' });
  o.n('o_book', 'appointmentNode', book('✅ ¡Listo! Tu consulta quedó agendada. Te enviamos el link de la videollamada antes del turno. ¡Gracias!'));
  o.e('start', 'o_welcome').e('o_welcome', 'o_nombre').e('o_nombre', 'o_tema');
  pollEdges(o, 'o_tema', o.nodes.find(n => n.id === 'o_tema').data.options, 'o_detalle');
  o.e('o_detalle', 'o_proposals').e('o_proposals', 'o_choice').e('o_choice', 'o_book');
  const otra = await post('Consulta General / Otra', 'otra,divorcio,familia,sucesion,sucesión,herencia', o);
  console.log('✅ Otra:', otra.id);

  // ---- Router: enlazar opción 4 (option-3 = Accidente) y opción 5 (option-4 = Otra) ----
  const rRes = await fetch(`${API}/api/flows/${ROUTER_ID}`);
  const router = await rRes.json();
  if (!rRes.ok || !router?.nodes) { console.error('❌ router', router); process.exit(1); }

  const addLink = (id, flowId, yoff) => {
    const ex = router.nodes.find(n => n.id === id);
    if (ex) { ex.data.flowId = flowId; }
    else { router.nodes.push({ id, type: 'flowLinkNode', position: { x: 600, y: yoff }, data: { flowId } }); }
  };
  addLink('r_link_accidente', accidente.id, 700);
  addLink('r_link_otra', otra.id, 780);
  router.edges = router.edges.map(e => {
    if (e.source === 'r_menu' && e.sourceHandle === 'option-3') return { ...e, target: 'r_link_accidente' };
    if (e.source === 'r_menu' && e.sourceHandle === 'option-4') return { ...e, target: 'r_link_otra' };
    return e;
  });
  const pRes = await fetch(`${API}/api/flows/${ROUTER_ID}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: router.nodes, edges: router.edges }) });
  console.log(pRes.ok ? '🔧 Router: opción 4 → Accidente, opción 5 → Otra' : '⚠️ no se pudo actualizar el router');
})().catch(e => { console.error(e); process.exit(1); });

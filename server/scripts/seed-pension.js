/**
 * Crea subflow "Consulta Pensión por Viudez" y lo enlaza desde el Router (opción 2).
 * Uso: node scripts/seed-pension.js <ACCOUNT_ID> <ROUTER_FLOW_ID> [API_URL]
 */
const ACCOUNT_ID = process.argv[2];
const ROUTER_ID = process.argv[3];
const API = process.argv[4] || 'http://localhost:3001';
if (!ACCOUNT_ID || !ROUTER_ID) { console.error('Uso: node ... <ACCOUNT_ID> <ROUTER_FLOW_ID>'); process.exit(1); }

let y = 0;
const Y = () => (y += 130);
const node = (id, type, data) => ({ id, type, position: { x: 250, y: Y() }, data });
const edge = (s, t, h = null) => ({ id: `e-${s}-${t}-${h || 'd'}`, source: s, target: t, sourceHandle: h, targetHandle: null, animated: true, style: { strokeWidth: 2, stroke: '#6366f1' } });

(async () => {
  // 1) Subflow Pensión por Viudez
  const nodes = [
    { id: 'start', type: 'input', position: { x: 250, y: 0 }, data: { label: 'Inicio' }, style: { background: '#22c55e', color: 'white', border: 'none', fontWeight: 'bold' } },
    node('p_welcome', 'messageNode', { text: '🕊️ Lamento tu pérdida. Te ayudo con la *pensión por viudez*. Te hago unas preguntas para tu cita gratuita 👇' }),
    node('p_nombre', 'questionNode', { question: '¿A nombre de quién es la consulta?', variable: 'nombre' }),
    node('p_vinculo', 'pollNode', { question: '¿Cuál era tu vínculo con la persona fallecida?', options: ['Cónyuge (casados)', 'Conviviente / pareja', 'Otro'], variable: 'vinculo' }),
    node('p_fallecido', 'pollNode', { question: '¿La persona fallecida era...?', options: ['Jubilado / Pensionado', 'Trabajaba en relación de dependencia', 'Trabajaba en negro / autónomo', 'No sé'], variable: 'situacion' }),
    node('p_detalle', 'questionNode', { question: 'Contame brevemente: hace cuánto falleció, si tenés hijos a cargo y si ya iniciaste algún trámite en ANSES.', variable: 'resumen' }),
    node('p_proposals', 'appointmentProposalsNode', {
      startHour: '09:00', endHour: '18:00', allowedDays: [1, 2, 3, 4, 5], slotDuration: 30, maxProposals: 3, outputVariable: 'horarios',
      text: '📅 Estos son los próximos horarios para tu *consulta virtual gratuita*:\n\n{{horarios}}',
    }),
    node('p_choice', 'questionNode', { question: 'Respondé con el *número* de la opción que preferís (1, 2 o 3):', variable: 'opcion_horario' }),
    node('p_book', 'appointmentNode', {
      nombreVar: 'nombre', telefonoVar: '', resumenVar: 'resumen', slotChoiceVar: 'opcion_horario', slotsVar: 'horarios_array',
      text: '✅ ¡Listo! Tu consulta por pensión quedó agendada. Te enviamos el link de la videollamada antes del turno. ¡Gracias!',
    }),
  ];
  const edges = [
    edge('start', 'p_welcome'), edge('p_welcome', 'p_nombre'), edge('p_nombre', 'p_vinculo'),
    ...['option-0', 'option-1', 'option-2'].map(h => edge('p_vinculo', 'p_fallecido', h)),
    ...['option-0', 'option-1', 'option-2', 'option-3'].map(h => edge('p_fallecido', 'p_detalle', h)),
    edge('p_detalle', 'p_proposals'), edge('p_proposals', 'p_choice'), edge('p_choice', 'p_book'),
  ];

  const res = await fetch(`${API}/api/flows`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: ACCOUNT_ID, name: 'Consulta Pensión por Viudez', trigger_word: 'pension,pensión,viudez', is_active: true, nodes, edges }) });
  const pension = await res.json();
  if (!res.ok) { console.error('❌ subflow', pension); process.exit(1); }
  console.log('✅ Subflow Pensión:', pension.id);

  // 2) Router: enlazar opción 2 (Pensión) a este subflow
  const rRes = await fetch(`${API}/api/flows/${ROUTER_ID}`);
  const router = await rRes.json();
  if (!rRes.ok || !router?.nodes) { console.error('❌ no se pudo leer el router', router); process.exit(1); }

  // agregar flowLinkNode si no existe
  if (!router.nodes.some(n => n.id === 'r_link_pension')) {
    const ref = router.nodes.find(n => n.id === 'r_asesor') || router.nodes[router.nodes.length - 1];
    router.nodes.push({ id: 'r_link_pension', type: 'flowLinkNode', position: { x: 600, y: (ref?.position?.y || 400) + 80 }, data: { flowId: pension.id } });
  } else {
    router.nodes.find(n => n.id === 'r_link_pension').data.flowId = pension.id;
  }
  // repuntar el edge de option-1 (Pensión) hacia el flowLink
  router.edges = router.edges.map(e =>
    (e.source === 'r_menu' && e.sourceHandle === 'option-1') ? { ...e, target: 'r_link_pension' } : e
  );

  const pRes = await fetch(`${API}/api/flows/${ROUTER_ID}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: router.nodes, edges: router.edges }) });
  console.log(pRes.ok ? '🔧 Router opción 2 (Pensión) → subflow Pensión' : '⚠️ no se pudo actualizar el router');
})().catch(e => { console.error(e); process.exit(1); });

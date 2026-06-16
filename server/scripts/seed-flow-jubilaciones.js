/**
 * Crea el flujo "Agendamiento Jubilaciones" para la cuenta indicada vía la API.
 * Uso: node scripts/seed-flow-jubilaciones.js <ACCOUNT_ID> [API_URL]
 */
const ACCOUNT_ID = process.argv[2];
const API = process.argv[3] || 'http://localhost:3001';
if (!ACCOUNT_ID) { console.error('Falta ACCOUNT_ID'); process.exit(1); }

// Helpers para posicionar nodos en una columna legible.
let y = 0;
const Y = () => (y += 130);
const node = (id, type, data, x = 250) => ({ id, type, position: { x, y: Y() }, data });
const edge = (source, target, sourceHandle = null) => ({
  id: `e-${source}-${target}-${sourceHandle || 'd'}`,
  source, target, sourceHandle, targetHandle: null,
  animated: true, style: { strokeWidth: 2, stroke: '#6366f1' },
});

const nodes = [
  { id: 'start', type: 'input', position: { x: 250, y: 0 }, data: { label: 'Inicio' },
    style: { background: '#22c55e', color: 'white', border: 'none', fontWeight: 'bold' } },

  node('welcome', 'messageNode', {
    text: '¡Hola! 👵👴 En el estudio damos una *cita virtual gratuita* de asesoría jubilatoria.\n\nPrimero validamos 3 requisitos rápidos. ¿Empezamos?',
  }),

  // 1) Edad
  node('q_edad', 'questionNode', { question: '¿Qué edad tenés? (escribí solo el número, ej: 67)', variable: 'edad' }),
  node('c_edad', 'conditionNode', { variable: 'edad', operator: 'greater_than', expectedValue: '64' }),
  node('reject_edad', 'messageNode', { text: 'Para esta cita gratuita necesitás tener *65 años o más*. ¡Gracias por escribirnos! 🙏' }),

  // 2) Aportes
  node('q_aportes', 'questionNode', { question: '¿Cuántos *años de aportes* tenés? (solo el número, ej: 32)', variable: 'aportes' }),
  node('c_aportes', 'conditionNode', { variable: 'aportes', operator: 'greater_than', expectedValue: '29' }),
  node('reject_aportes', 'messageNode', { text: 'Para calificar necesitás *30 años o más* de aportes. ¡Gracias por tu consulta! 🙏' }),

  // 3) Nacionalidad
  node('q_nac', 'pollNode', { question: '¿Tenés *nacionalidad argentina*?', options: ['Sí', 'No'], variable: 'nacionalidad' }),
  node('reject_nac', 'messageNode', { text: 'Esta cita gratuita es para *ciudadanos argentinos*. ¡Gracias por escribirnos! 🙏' }),

  // 4) Nombre
  node('q_nombre', 'questionNode', { question: '¡Genial, calificás para la cita gratuita! ✅\n\n¿A nombre de quién la agendamos?', variable: 'nombre' }),

  // 5) Propuestas de horario (cita virtual, Lun-Vie 9 a 18, slots de 30')
  node('proposals', 'appointmentProposalsNode', {
    startHour: '09:00', endHour: '18:00', allowedDays: [1, 2, 3, 4, 5],
    slotDuration: 30, maxProposals: 3, outputVariable: 'horarios',
    text: '📅 Estos son los próximos horarios disponibles para tu *cita virtual*:\n\n{{horarios}}',
  }),

  // 6) Elección
  node('q_choice', 'questionNode', { question: 'Respondé con el *número* de la opción que preferís (1, 2 o 3):', variable: 'opcion_horario' }),

  // 7) Agendar (toma el slot elegido de horarios_array por índice)
  node('book', 'appointmentNode', {
    nombreVar: 'nombre', telefonoVar: '', resumenVar: 'resumen',
    slotChoiceVar: 'opcion_horario', slotsVar: 'horarios_array',
    text: '✅ ¡Listo! Tu *cita virtual* quedó agendada. Te enviamos el link de la videollamada antes del turno. ¡Gracias!',
  }),
];

const edges = [
  edge('start', 'welcome'),
  edge('welcome', 'q_edad'),
  edge('q_edad', 'c_edad'),
  edge('c_edad', 'q_aportes', 'true'),
  edge('c_edad', 'reject_edad', 'false'),
  edge('q_aportes', 'c_aportes'),
  edge('c_aportes', 'q_nac', 'true'),
  edge('c_aportes', 'reject_aportes', 'false'),
  edge('q_nac', 'q_nombre', 'option-0'),   // Sí
  edge('q_nac', 'reject_nac', 'option-1'), // No
  edge('q_nombre', 'proposals'),
  edge('proposals', 'q_choice'),
  edge('q_choice', 'book'),
];

const flow = {
  account_id: ACCOUNT_ID,
  name: 'Agendamiento Jubilaciones',
  trigger_word: 'hola,jubilacion,jubilación,jubilarme,cita,turno,asesoria,asesoría',
  is_active: true,
  nodes,
  edges,
};

(async () => {
  const res = await fetch(`${API}/api/flows`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(flow),
  });
  const body = await res.json();
  if (!res.ok) { console.error('❌', res.status, body); process.exit(1); }
  console.log('✅ Flujo creado:', body.id, '|', body.name, '| nodos:', nodes.length, '| edges:', edges.length);
})().catch(e => { console.error(e); process.exit(1); });

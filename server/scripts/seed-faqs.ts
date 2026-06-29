import 'dotenv/config';
import { supabase } from '../src/config/supabase';

const ACC = process.env.SMOKE_ACCOUNT_ID || 'fbf99cec-ddc9-4ef2-94d0-8f14d0bcb982';

const FAQS: Array<{ pregunta: string; respuesta: string; tags: string[] }> = [
  { pregunta: '¿Qué temas atiende el estudio?', respuesta: 'Somos un estudio previsional y laboral. Atendemos jubilaciones, pensiones por viudez, despidos y ART, accidentes de tránsito y temas de Veraz, entre otros. Contame tu caso y te oriento.', tags: ['temas','servicios','atienden','hacen','previsional','laboral'] },
  { pregunta: '¿Me puedo jubilar? Me faltan aportes', respuesta: 'Eso lo evaluamos según tu edad y años de aportes; muchas veces se completa con moratoria. Para verlo bien conviene una evaluación previsional con el estudio. ¿Querés que te coordine un turno?', tags: ['jubilacion','jubilarme','aportes','moratoria','anses','edad','retiro'] },
  { pregunta: '¿Qué es la moratoria previsional?', respuesta: 'Es un plan para regularizar años de aportes que te falten y poder acceder al beneficio. Si te aplica depende de tu situación; lo confirmamos en la evaluación. Te puedo agendar una consulta.', tags: ['moratoria','plan','aportes','regularizar','deuda','previsional'] },
  { pregunta: '¿Atienden pensión por fallecimiento del cónyuge?', respuesta: 'Sí, tramitamos pensión por viudez. Necesitamos ver tu situación particular; lo mejor es una consulta con una de nuestras abogadas. ¿Coordino un turno?', tags: ['pension','viudez','fallecimiento','conyuge','esposo','esposa','muerte'] },
  { pregunta: 'Me despidieron, ¿tengo derecho a algo?', respuesta: 'Depende de tu edad y tu oficio. En general desde los 63 años suele ser viable; en otros casos evaluamos según el trabajo. Lo vemos en una consulta. ¿Querés que te agende?', tags: ['despido','despidieron','art','trabajo','liquidacion','indemnizacion','laboral'] },
  { pregunta: 'Tuve un accidente de tránsito, ¿pueden ayudarme?', respuesta: 'Sí, siempre que el accidente sea de hace menos de 2 años. Para avanzar necesitamos los datos del siniestro. Te coordino una consulta para revisarlo.', tags: ['accidente','transito','choque','siniestro','seguro','aseguradora','lesiones'] },
  { pregunta: '¿Me pueden sacar del Veraz?', respuesta: 'Trabajamos casos de "Derecho al Olvido" para limpiar antecedentes. Tenemos un manual guía a $4.900. Si querés algo más a fondo, lo vemos en una consulta.', tags: ['veraz','deudas','derecho','olvido','antecedentes','nosis','bcra'] },
  { pregunta: '¿Dónde quedan las oficinas?', respuesta: 'Atendemos presencial en CABA, Quilmes y Haedo, y también por videollamada si te queda más cómodo. ¿Cuál te sirve y te busco un turno?', tags: ['oficina','oficinas','direccion','donde','ubicacion','caba','quilmes','haedo','presencial'] },
  { pregunta: '¿Atienden por videollamada?', respuesta: 'Sí, hacemos consultas por videollamada. Te paso el día y horario y te llega el enlace. ¿Querés coordinar una?', tags: ['videollamada','video','virtual','online','zoom','remoto','distancia'] },
  { pregunta: '¿Qué días y horarios atienden?', respuesta: 'Atendemos de lunes a viernes en horario de oficina. Los turnos son con cita previa. Decime qué día te viene bien y busco disponibilidad.', tags: ['horario','horarios','dias','atencion','cuando','abren','turnos'] },
  { pregunta: '¿Cuánto sale la consulta?', respuesta: 'La consulta previsional tiene un costo de $29.000. En jubilaciones y otros temas, muchas veces la primera orientación es sin cargo: te lo confirmo según tu caso. ¿Coordino un turno?', tags: ['precio','costo','cuanto','sale','honorarios','consulta','cobran','arancel'] },
  { pregunta: '¿Cómo saco un turno?', respuesta: 'Es fácil: decime el tema y si preferís presencial (CABA, Quilmes o Haedo) o videollamada, y te ofrezco horarios disponibles. ¿Empezamos?', tags: ['turno','cita','agendar','reservar','sacar','coordinar','como'] },
  { pregunta: '¿Qué tengo que llevar a la cita?', respuesta: 'Si es por jubilación, conviene traer tu DNI y, si la tenés, la clave de ANSES o la sábana de aportes. Si no las tenés a mano, no te preocupes, igual avanzamos.', tags: ['llevar','traer','documentacion','papeles','requisitos','dni','clave','anses','aportes'] },
  { pregunta: '¿Cuánto tarda un trámite jubilatorio?', respuesta: 'Los tiempos dependen de cada caso y de ANSES, así que prefiero que te dé una estimación realista la abogada en la consulta, sin prometerte de más. ¿Te agendo?', tags: ['tarda','tiempo','demora','cuanto','tramite','jubilatorio','plazos'] },
];

(async () => {
  const { error: delErr } = await supabase.from('account_faqs').delete().eq('account_id', ACC);
  if (delErr) { console.log('DELETE error:', delErr.message); process.exit(1); }
  const rows = FAQS.map((f) => ({ account_id: ACC, pregunta: f.pregunta, respuesta: f.respuesta, tags: f.tags }));
  const { data, error } = await supabase.from('account_faqs').insert(rows).select('id');
  if (error) { console.log('INSERT error:', error.message); process.exit(1); }
  console.log(`✅ ${data?.length ?? 0} FAQs cargadas para ${ACC}`);
  process.exit(0);
})();

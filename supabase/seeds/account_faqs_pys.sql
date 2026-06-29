-- Seed de account_faqs para el Estudio Prats & Simon (PYS).
-- Base de conocimiento del agente IA-primero (grounding ESTRICTO: el bot solo
-- responde temas previsionales con lo que esté acá; si no está, deriva a humano).
--
-- Cómo usar (Supabase SQL editor o psql):
--   1) Aplicá antes la migración 0015 (crea account_faqs).
--   2) Editá el UUID de la cuenta piloto en la línea `acc :=` de abajo.
--   3) Ejecutá. Es re-ejecutable: borra las FAQs previas de esa cuenta y recarga.
--
-- Las respuestas son CORTAS y prudentes: no prometen resultados legales; cuando el
-- caso es puntual, orientan a agendar o a que lo confirme el estudio.

DO $$
DECLARE
  acc uuid := 'fbf99cec-ddc9-4ef2-94d0-8f14d0bcb982';  -- <<< CAMBIAR por la cuenta piloto
BEGIN
  DELETE FROM account_faqs WHERE account_id = acc;

  INSERT INTO account_faqs (account_id, pregunta, respuesta, tags) VALUES
  (acc,
   '¿Qué temas atiende el estudio?',
   'Somos un estudio previsional y laboral. Atendemos jubilaciones, pensiones por viudez, despidos y ART, accidentes de tránsito y temas de Veraz, entre otros. Contame tu caso y te oriento.',
   ARRAY['temas','servicios','atienden','hacen','previsional','laboral']),

  (acc,
   '¿Me puedo jubilar? Me faltan aportes',
   'Eso lo evaluamos según tu edad y años de aportes; muchas veces se completa con moratoria. Para verlo bien conviene una evaluación previsional con el estudio. ¿Querés que te coordine un turno?',
   ARRAY['jubilacion','jubilarme','aportes','moratoria','anses','edad','retiro']),

  (acc,
   '¿Qué es la moratoria previsional?',
   'Es un plan para regularizar años de aportes que te falten y poder acceder al beneficio. Si te aplica depende de tu situación; lo confirmamos en la evaluación. Te puedo agendar una consulta.',
   ARRAY['moratoria','plan','aportes','regularizar','deuda','previsional']),

  (acc,
   '¿Atienden pensión por fallecimiento del cónyuge?',
   'Sí, tramitamos pensión por viudez. Necesitamos ver tu situación particular; lo mejor es una consulta con una de nuestras abogadas. ¿Coordino un turno?',
   ARRAY['pension','viudez','fallecimiento','conyuge','esposo','esposa','muerte']),

  (acc,
   'Me despidieron, ¿tengo derecho a algo?',
   'Depende de tu edad y tu oficio. En general desde los 63 años suele ser viable; en otros casos evaluamos según el trabajo. Lo vemos en una consulta. ¿Querés que te agende?',
   ARRAY['despido','despidieron','art','trabajo','liquidacion','indemnizacion','laboral']),

  (acc,
   'Tuve un accidente de tránsito, ¿pueden ayudarme?',
   'Sí, siempre que el accidente sea de hace menos de 2 años. Para avanzar necesitamos los datos del siniestro. Te coordino una consulta para revisarlo.',
   ARRAY['accidente','transito','choque','siniestro','seguro','aseguradora','lesiones']),

  (acc,
   '¿Me pueden sacar del Veraz?',
   'Trabajamos casos de "Derecho al Olvido" para limpiar antecedentes. Tenemos un manual guía a $4.900. Si querés algo más a fondo, lo vemos en una consulta.',
   ARRAY['veraz','deudas','derecho','olvido','antecedentes','nosis','bcra']),

  (acc,
   '¿Dónde quedan las oficinas?',
   'Atendemos presencial en CABA, Quilmes y Haedo, y también por videollamada si te queda más cómodo. ¿Cuál te sirve y te busco un turno?',
   ARRAY['oficina','oficinas','direccion','donde','ubicacion','caba','quilmes','haedo','presencial']),

  (acc,
   '¿Atienden por videollamada?',
   'Sí, hacemos consultas por videollamada. Te paso el día y horario y te llega el enlace. ¿Querés coordinar una?',
   ARRAY['videollamada','video','virtual','online','zoom','remoto','distancia']),

  (acc,
   '¿Qué días y horarios atienden?',
   'Atendemos de lunes a viernes en horario de oficina. Los turnos son con cita previa. Decime qué día te viene bien y busco disponibilidad.',
   ARRAY['horario','horarios','dias','atencion','cuando','abren','turnos']),

  (acc,
   '¿Cuánto sale la consulta?',
   'La consulta previsional tiene un costo de $29.000. En jubilaciones y otros temas, muchas veces la primera orientación es sin cargo: te lo confirmo según tu caso. ¿Coordino un turno?',
   ARRAY['precio','costo','cuanto','sale','honorarios','consulta','cobran','arancel']),

  (acc,
   '¿Cómo saco un turno?',
   'Es fácil: decime el tema y si preferís presencial (CABA, Quilmes o Haedo) o videollamada, y te ofrezco horarios disponibles. ¿Empezamos?',
   ARRAY['turno','cita','agendar','reservar','sacar','coordinar','como']),

  (acc,
   '¿Qué tengo que llevar a la cita?',
   'Si es por jubilación, conviene traer tu DNI y, si la tenés, la clave de ANSES o la sábana de aportes. Si no las tenés a mano, no te preocupes, igual avanzamos.',
   ARRAY['llevar','traer','documentacion','papeles','requisitos','dni','clave','anses','aportes']),

  (acc,
   '¿Cuánto tarda un trámite jubilatorio?',
   'Los tiempos dependen de cada caso y de ANSES, así que prefiero que te dé una estimación realista la abogada en la consulta, sin prometerte de más. ¿Te agendo?',
   ARRAY['tarda','tiempo','demora','cuanto','tramite','jubilatorio','plazos']);

  RAISE NOTICE 'account_faqs cargadas para %', acc;
END $$;

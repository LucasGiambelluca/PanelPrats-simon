// ─── AskLoopGuard ─────────────────────────────────────────────────────────────
// Detecta el loop semántico donde el bot repite el MISMO dato de calificación con
// fraseo variado (el anti-echo no lo caza). Funciones puras: sin IA, sin reloj, sin red.
// El controller computa el streak; al pasar el umbral, inyecta una directiva de
// escalación al system prompt para que el LLM reformule y avance (nunca repita).

import { norm } from './normalize';

export type AskTopic =
  | 'nombre' | 'edad' | 'aportes' | 'insalubres' | 'nacionalidad'
  | 'anio_ingreso' | 'hijos' | 'zona' | 'telefono' | 'horario';

export interface AskStreak { topic: AskTopic; count: number }

// Orden IMPORTA: los específicos antes que los genéricos (insalubres/anio_ingreso
// contienen palabras que también matchearían edad/nacionalidad).
const TOPIC_PATTERNS: Array<[AskTopic, RegExp]> = [
  ['insalubres', /insalubre|tareas? pesadas?|trabajo (pesado|insalubre)/],
  ['anio_ingreso', /ano.*ingreso|ingreso al pais|figura en el dni/],
  ['aportes', /aportes?|anios? de aporte|cuanto aporto/],
  ['nacionalidad', /argentino o extranjero|nacionalidad|es extranjero/],
  ['hijos', /cuantos hijos|tiene hijos/],
  ['edad', /cuantos anos tiene|su edad|que edad/],
  ['nombre', /su nombre|como se llama|a nombre de quien|me dice su nombre|decirme su nombre/],
  ['zona', /que zona|localidad|donde vive|de donde es/],
  ['telefono', /telefono|celular|numero.*contact|numero.*whatsapp|a que numero/],
  ['horario', /que horario|cual le queda|dia le queda|le ofrezco|tengo disponible/],
];

/** Qué dato pidió el bot en su último mensaje. null si no pregunta un dato. */
export function detectAskedTopic(botText: string): AskTopic | null {
  const t = norm(botText);
  if (!t) return null;
  for (const [topic, re] of TOPIC_PATTERNS) if (re.test(t)) return topic;
  return null;
}

const HAS_NUM = /\d/;
function mencionaOficioInsalubre(t: string): boolean {
  return /construccion|albanil|obra|mineria|minero|fundicion|frigorifico|estiba|pintura|soldadura|lavadero|petrole|quimic/.test(t);
}

/** ¿El mensaje del cliente responde ese tema? Heurística por tipo de dato. */
export function clientAnswered(topic: AskTopic, clientText: string): boolean {
  const t = norm(clientText);
  if (!t) return false;
  switch (topic) {
    case 'aportes': case 'edad': case 'hijos': case 'anio_ingreso':
      return HAS_NUM.test(t);
    case 'telefono':
      return (t.replace(/\D/g, '').length >= 8);
    case 'insalubres':
      return /\b(si|sip|no|nop|tengo|tuve|nunca|jamas|tareas? insalubres?)\b/.test(t) || mencionaOficioInsalubre(t);
    case 'nacionalidad':
      return /argentin|extranjer|boliviano|paraguayo|peruano|chileno|uruguayo|nacido/.test(t);
    case 'nombre':
      return t.split(' ').some((w) => /^[a-z]{3,}$/.test(w) && !['hola', 'buenas', 'gracias', 'senor', 'senora'].includes(w));
    case 'zona':
      return t.split(' ').some((w) => w.length >= 3);
    case 'horario':
      return HAS_NUM.test(t) || /manana|tarde|lunes|martes|miercoles|jueves|viernes|mediodia/.test(t);
    default:
      return false;
  }
}

/** Mismo tema no respondido → count++; tema nuevo → 1; respondido o sin-pregunta → null. */
export function nextStreak(prev: AskStreak | null, asked: AskTopic | null, answered: boolean): AskStreak | null {
  if (!asked || answered) return null;
  if (prev && prev.topic === asked) return { topic: asked, count: prev.count + 1 };
  return { topic: asked, count: 1 };
}

const TEMA_ES: Record<AskTopic, string> = {
  nombre: 'el nombre', edad: 'la edad', aportes: 'los años de aportes',
  insalubres: 'los aportes por tareas insalubres', nacionalidad: 'la nacionalidad',
  anio_ingreso: 'el año de ingreso al país', hijos: 'la cantidad de hijos',
  zona: 'la zona/localidad', telefono: 'el teléfono', horario: 'el horario',
};

/** Directiva a inyectar al system prompt. null si count < 2. */
export function escalationDirective(topic: AskTopic, count: number): string | null {
  const tema = TEMA_ES[topic];
  if (count < 2) return null;
  if (count === 2) {
    return `El cliente todavía no respondió sobre ${tema}. Reformulá la pregunta de forma MÁS SIMPLE y corta, UNA sola vez, con otras palabras. No repitas la frase anterior.`;
  }
  if (count === 3) {
    return `Es tu ÚLTIMO intento por ${tema}: preguntalo de la forma más simple posible, con un ejemplo concreto. Si el cliente ya intentó responder, no insistas más.`;
  }
  return `NO vuelvas a preguntar ${tema}. Registrá la calificación con lo que ya tenés: si ${tema} es necesario para decidir gratis/pago, llamá set_qualification con a_confirmar incluyendo "${topic}" y resultado "gratis"; si no es decisivo, seguí al paso siguiente (agendar). Nunca dejes al cliente esperando por ${tema}.`;
}

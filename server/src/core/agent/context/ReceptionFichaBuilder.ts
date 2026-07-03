// ─── ReceptionFichaBuilder (Capacidad 2) ──────────────────────────────────────
// Paso de enriquecimiento PRE-booking: corre una pasada de IA sobre la conversación
// y produce una ficha estructurada + un resumen natural para que el profesional
// tenga contexto en 10 segundos. El modelo NO arma el resumen "a mano" en el chat:
// lo arma este builder con un prompt dedicado de extracción.
//
// REGLA DURA: nunca inventa. Todo dato que no se pueda extraer queda en null.
// telefono y modalidad SIEMPRE vienen del contexto server-side, jamás del modelo.

import type { AppointmentMotivo } from '../../../services/AppointmentService';

export interface FichaContext {
  telefono: string;
  modalidad: 'presencial' | 'video';
  zona?: string | null;
}

export interface ReceptionFicha {
  nombre: string | null;
  dni: string | null;
  edad: number | null;
  telefono: string;
  zona: string | null;
  modalidad: 'presencial' | 'video';
  motivo: AppointmentMotivo | null;
  anios_aporte: number | null;
  nacionalidad: string | null;   // 'argentino' | 'extranjero' — respaldo si falta la calificación
  insalubres: boolean | null;    // aportes por tareas insalubres — respaldo si falta la calificación
  situacion_previsional: string | null;
  resumen_ia: string;
}

interface AILike { complete: (opts: any) => Promise<string> }

const MOTIVOS: AppointmentMotivo[] = [
  'jubilacion', 'puam', 'pension_v', 'reajuste', 'rti',
  'laboral', 'pension_discapacidad', 'asesoramiento_pago', 'otro',
];

const EXTRACT_PROMPT = [
  'Sos recepcionista de un estudio previsional y laboral. Leé TODA la conversación y armá',
  'una ficha para que la abogada/profesional entienda el caso en 10 segundos. Respondé SOLO JSON:',
  '{"nombre":..,"dni":..,"edad":..,"motivo":..,"anios_aporte":..,"nacionalidad":..,"insalubres":..,"zona":..,"situacion_previsional":..,"resumen_ia":".."}',
  '',
  'REGLAS:',
  '- NO inventes datos personales. Si NO se dijo, poné null (nombre, dni, edad, anios_aporte).',
  `- "motivo": inferilo del tema. SOLO uno de: ${MOTIVOS.join(', ')} (o null si no se entiende).`,
  '  Mapeo: jubilarse/jubilación/ANSES/moratoria→"jubilacion"; pensión por viudez/fallecimiento→"pension_v";',
  '  despido/me echaron/indemnización/ART/accidente laboral→"laboral"; reajuste de haberes→"reajuste";',
  '  pensión por discapacidad→"pension_discapacidad"; PUAM→"puam"; reconocimiento de servicios→"rti".',
  '- "edad" y "anios_aporte" enteros o null.',
  '- "nacionalidad": "argentino" | "extranjero" | null (null si no se habló).',
  '- "insalubres": true si dijo que tiene aportes por tareas insalubres/trabajo pesado, false si dijo que no, null si no se habló.',
  '- "zona": localidad/barrio si se mencionó, o null.',
  '- "situacion_previsional": frase corta del estado (ej "le faltan 2 años de aportes") o null.',
  '- "resumen_ia": SIEMPRE 2-3 frases en español rioplatense con lo que SÍ se sabe (quién es, qué',
  '  necesita, modalidad/zona si surge, qué falta). Aunque haya pocos datos, escribilo con lo disponible;',
  '  NO lo dejes vacío salvo que no haya absolutamente nada de contexto.',
].join('\n');

function toIntInRange(v: any, min: number, max: number): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'number' ? v : parseInt(String(v).replace(/[^\d]/g, ''), 10);
  if (!Number.isFinite(n) || n < min || n > max) return null;
  return n;
}

/** Normaliza la salida cruda (del modelo) a una ficha segura. Nunca inventa. */
export function sanitizeFicha(raw: any, ctx: FichaContext): ReceptionFicha {
  const o = raw && typeof raw === 'object' ? raw : {};
  const dniDigits = String(o.dni ?? '').replace(/[^\d]/g, '');
  const motivo = MOTIVOS.includes(o.motivo) ? o.motivo : null;
  return {
    nombre: typeof o.nombre === 'string' && o.nombre.trim() ? o.nombre.trim() : null,
    dni: dniDigits.length >= 7 && dniDigits.length <= 9 ? dniDigits : null,
    edad: toIntInRange(o.edad, 1, 120),
    telefono: ctx.telefono,                 // server-side, no del modelo
    zona: ctx.zona ?? (typeof o.zona === 'string' && o.zona.trim() ? o.zona.trim() : null),
    modalidad: ctx.modalidad,               // server-side, no del modelo
    motivo,
    anios_aporte: toIntInRange(o.anios_aporte, 0, 70),
    nacionalidad: o.nacionalidad === 'argentino' || o.nacionalidad === 'extranjero' ? o.nacionalidad : null,
    insalubres: o.insalubres === true || o.insalubres === 'true' ? true : (o.insalubres === false || o.insalubres === 'false' ? false : null),
    situacion_previsional: typeof o.situacion_previsional === 'string' && o.situacion_previsional.trim()
      ? o.situacion_previsional.trim() : null,
    resumen_ia: typeof o.resumen_ia === 'string' ? o.resumen_ia.trim() : '',
  };
}

/** Corre la extracción con IA y devuelve la ficha saneada. Degrada con gracia. */
export async function buildReceptionFicha(
  ai: AILike,
  input: { conversation: string; ctx: FichaContext; apiKey?: string; model?: string },
): Promise<ReceptionFicha> {
  try {
    const raw = await ai.complete({
      systemPrompt: EXTRACT_PROMPT,
      userMessage: input.conversation,
      jsonMode: true,
      temperature: 0,
      maxTokens: 400,
      apiKey: input.apiKey,
      model: input.model,
    });
    let parsed: any = {};
    try {
      const clean = String(raw).replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
      parsed = JSON.parse(clean);
    } catch { parsed = {}; }
    return sanitizeFicha(parsed, input.ctx);
  } catch {
    return sanitizeFicha({}, input.ctx);
  }
}

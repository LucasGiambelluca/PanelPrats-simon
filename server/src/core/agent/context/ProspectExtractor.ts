// ─── ProspectExtractor ────────────────────────────────────────────────────────
// Pasada de extracción PROFUNDA sobre mensajes ricos (1er mensaje o ≥120 chars).
// LLM enjaulado: temp 0, JSON cerrado; los saneadores de código deciden qué entra.
// REGLA DURA: nunca throw. Falla → { slots:{}, area:null } y la conversación sigue.

import { validarTelefonoAR } from '../../../utils/phone-ar';
import { detectArea } from './AreaDetector';

export interface ProspectResult {
  slots: Record<string, string | number>;
  area: string | null;
}

interface AILike { complete: (opts: any) => Promise<string> }

const num = (v: any): number | null => {
  const n = typeof v === 'number' ? v : parseInt(String(v ?? ''), 10);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};
const str = (v: any): string => (typeof v === 'string' ? v.trim() : '');

/** Gating puro: 1er mensaje o ≥120 chars, máx 1 pasada por día (comparación fecha UTC). */
export function shouldExtract(input: {
  text: string;
  historyLength: number;
  extractorLastAt: string | null | undefined;
  now: string;
}): boolean {
  const rich = input.historyLength === 0 || input.text.trim().length >= 120;
  if (!rich) return false;
  if (input.extractorLastAt && input.extractorLastAt.slice(0, 10) === input.now.slice(0, 10)) return false;
  return true;
}

/** Saneo del crudo del modelo. Nada pasa sin validar. Claves de salida = las del resto del sistema. */
export function sanitizeProspect(raw: any, originalText: string): ProspectResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { slots: {}, area: null };

  const area =
    detectArea(originalText) ??
    (str(raw.area_texto) ? detectArea(str(raw.area_texto)) : null);

  const slots: Record<string, string | number> = {};

  const nombre = str(raw.nombre);
  if (nombre.length >= 2 && nombre.length <= 60) slots.nombre = nombre;

  const edad = num(raw.edad);
  if (edad !== null && edad >= 18 && edad <= 110) slots.edad = edad;

  const aportes = num(raw.anios_aporte);
  if (aportes !== null && aportes >= 0 && aportes <= 60) slots.anios_aporte = aportes;

  const hijos = num(raw.hijos);
  if (hijos !== null && hijos >= 0 && hijos <= 20) slots.hijos = hijos;

  const genero = str(raw.genero).toLowerCase();
  if (genero === 'm' || genero === 'f') slots.genero = genero;

  const modalidad = str(raw.modalidad).toLowerCase();
  if (modalidad === 'presencial' || modalidad === 'video') slots.modalidad = modalidad;

  // localidad → clave 'zona': la clave que ya usan BookingFlow y el clasificador.
  const zona = str(raw.localidad);
  if (zona && zona.length <= 80) slots.zona = zona;

  const tel = str(raw.telefono);
  if (tel) {
    const v = validarTelefonoAR(tel);
    if (v.valido && v.normalizado) slots.telefono = v.normalizado;
  }

  const urgencia = str(raw.urgencia).toLowerCase();
  if (urgencia === 'alta' || urgencia === 'normal') slots.urgencia = urgencia;

  const horario = str(raw.mejor_horario);
  if (horario && horario.length <= 60) slots.mejor_horario = horario;

  return { slots, area };
}

const EXTRACT_PROMPT = [
  'Sos extractor de datos para un estudio previsional y laboral argentino.',
  'Del mensaje del usuario extraé SOLO los datos que estén EXPLÍCITOS. Respondé SOLO JSON:',
  '',
  '{"nombre":..,"edad":..,"genero":"m|f","anios_aporte":..,"localidad":..,"telefono":..,"modalidad":"presencial|video","area_texto":..,"hijos":..,"urgencia":"alta|normal","mejor_horario":..}',
  '',
  'REGLAS:',
  '- Dato AUSENTE → null. NUNCA inventes ni deduzcas (no adivines género por el nombre; solo si hay dato explícito).',
  '- "edad" y "anios_aporte" enteros. "telefono" tal cual lo escribió.',
  '- "localidad": ciudad/barrio/zona donde vive.',
  '- "area_texto": frase textual del motivo de consulta (ej. "quiero jubilarme", "me despidieron").',
  '- "urgencia": "alta" solo si expresa apuro explícito.',
  '- SOLO JSON, sin markdown.',
].join('\n');

/** Llamada al LLM + saneo. Best-effort: cualquier falla → resultado vacío. */
export async function extractProspect(
  ai: AILike,
  input: { text: string; history?: Array<{ role: 'user' | 'assistant'; content: string }>; apiKey?: string; model?: string },
): Promise<ProspectResult> {
  try {
    const historyLines = (input.history ?? [])
      .slice(-4)
      .map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
      .join('\n');
    const userMessage = [historyLines, `Mensaje a extraer: "${input.text}"`].filter(Boolean).join('\n');

    const raw = await ai.complete({
      systemPrompt: EXTRACT_PROMPT,
      userMessage,
      jsonMode: true,
      temperature: 0,
      maxTokens: 250,
      apiKey: input.apiKey,
      model: input.model,
    });

    let parsed: any = {};
    try {
      const clean = String(raw).replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = {};
    }
    return sanitizeProspect(parsed, input.text);
  } catch {
    return { slots: {}, area: null };
  }
}

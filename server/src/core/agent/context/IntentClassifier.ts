// ─── IntentClassifier (Fase 2) ─────────────────────────────────────────────────
// Clasifica cada mensaje entrante en intención + datos aportados.
// Salida JSON determinístico (temperature 0). El LLM queda enjaulado: solo clasifica.
//
// REGLA DURA: nunca throw. Si el modelo falla o devuelve no-JSON → fallback neutro.
// Refuerzo server-side de opt-out: detectOptOut() matchea con regex y PISA al modelo.

export type IntentLabel =
  | 'saludo'           // hola / buenas (apertura)
  | 'agendar'          // quiere turno
  | 'consultar'        // pregunta FAQ/previsional
  | 'responder_dato'   // aporta uno o más slots (nombre, dni, edad, etc.)
  | 'negacion'         // no / ninguno
  | 'despedida'        // gracias, listo, chau (cierre natural)
  | 'opt_out'          // "no me molesten más"
  | 'off_topic'        // fuera de alcance del estudio
  | 'frustracion'      // enojo / queja
  | 'otro';

export interface IntentResult {
  intent: IntentLabel;
  quiere_continuar: boolean;           // false si opt_out o cierre claro
  nivel_frustracion: 0 | 1 | 2 | 3;   // 3 = derivar a humano
  es_cierre: boolean;                  // la persona da por terminada la charla
  slots_detectados: Record<string, string | number>; // datos crudos extraídos ESTE turno
  confianza: number;                   // 0..1
}

export interface IntentContext {
  dialogueState?: any;       // estado actual (opcional; para dar contexto al prompt)
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  area?: string | null;      // AreaKey detectada, si la hay
}

interface AILike { complete: (opts: any) => Promise<string> }

// ─── Enum de labels (lista cerrada para el sanitizador) ───────────────────────
const INTENT_LABELS: IntentLabel[] = [
  'saludo', 'agendar', 'consultar', 'responder_dato',
  'negacion', 'despedida', 'opt_out', 'off_topic', 'frustracion', 'otro',
];

// ─── Fallback neutro ───────────────────────────────────────────────────────────
const NEUTRAL_FALLBACK: IntentResult = {
  intent: 'otro',
  quiere_continuar: true,
  nivel_frustracion: 0,
  es_cierre: false,
  slots_detectados: {},
  confianza: 0,
};

// ─── Prompt del clasificador ───────────────────────────────────────────────────
const CLASSIFY_PROMPT = [
  'Sos clasificador de intenciones para un estudio previsional y laboral.',
  'Analizá el último mensaje del usuario y respondé SOLO JSON (sin texto extra):',
  '',
  '{"intent":..,"quiere_continuar":..,"nivel_frustracion":..,"es_cierre":..,"slots_detectados":{...},"confianza":..}',
  '',
  'REGLAS:',
  `- "intent": EXACTAMENTE uno de: ${INTENT_LABELS.join(', ')}.`,
  '  saludo = hola/buenas/buen día (apertura); agendar = quiere turno/cita; consultar = pregunta informativa;',
  '  responder_dato = aporta datos propios (nombre, dni, edad, aportes, etc.); negacion = no/ninguno;',
  '  despedida = gracias/listo/chau (cierre natural); opt_out = no me escriban/baja/stop;',
  '  off_topic = fuera del alcance del estudio; frustracion = enojo/queja explícita; otro = no encaja.',
  '- "quiere_continuar": false solo si opt_out o cierre definitivo.',
  '- "nivel_frustracion": entero 0-3 (0=ninguna, 3=muy alto → derivar a humano).',
  '- "es_cierre": true si la persona da por terminada la charla.',
  '- CONTEXTO: mirá la ÚLTIMA línea "Asistente:" del historial. Si el mensaje del usuario',
  '  RESPONDE esa pregunta (ej. el Asistente preguntó nacionalidad/zona/horario y el usuario',
  '  dice "Argentino" / "San Luis" / "a la tarde"), es "responder_dato", NUNCA "off_topic".',
  '- "off_topic" SOLO si el tema es ajeno al estudio (jubilación, pensión, laboral, ART,',
  '  accidentes). Una respuesta breve a lo que se venía hablando NO es off_topic.',
  '- "slots_detectados": objeto con datos aportados SOLO en ESTE mensaje (no inventes, no repitas del historial).',
  '  Claves sugeridas: nombre, dni, edad, anios_aporte, fecha, hora, modalidad, zona, nacionalidad.',
  '- "confianza": número 0.0-1.0 de qué tan seguro estás.',
  '- Respondé en español rioplatense. Temperatura 0. SOLO JSON, sin markdown.',
].join('\n');

// ─── Normalización de texto para regex de opt-out ─────────────────────────────
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // quita acentos
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/ñ/g, 'n');
}

// ─── Regex de opt-out (refuerzo server-side, nunca depende solo del LLM) ──────
const OPT_OUT_PATTERNS = [
  /\bno\s+me\s+(molesten|escriban|contacten)\b/,
  /\bno\s+(me\s+)?escriban\s*(mas|más)?\b/,
  /\bno\s+quiero\s+que\s+me\s+(escriban|contacten|molesten)\b/,
  /\bdejen\s+de\s+(escribir|escribirme|molestar|contactar)\b/,
  // "darme de baja" = baja de los mensajes, PERO no "darme de baja del/de la X"
  // (sindicato, plan médico, AFIP…) que es una consulta legítima del estudio.
  /\bdar(me)?\s+de\s+baja\b(?!\s+(de|del)\b)/,
  /\bcancelar\s+(su\s+)?suscripcion\b/,
  /^\s*baja\s*$/,
  /\bstop\b/,
];

/**
 * Refuerzo determinístico de opt-out (NUNCA depende solo del LLM).
 * Matchea sobre texto normalizado: lowercase + sin acentos.
 */
export function detectOptOut(text: string): boolean {
  const normalized = normalizeText(text);
  return OPT_OUT_PATTERNS.some((re) => re.test(normalized));
}

/**
 * Normaliza el crudo del modelo a un IntentResult seguro.
 * Pura, testeable, nunca tira ni inventa.
 */
export function sanitizeIntent(raw: any): IntentResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...NEUTRAL_FALLBACK };
  }

  // intent: debe estar en el enum
  const intent: IntentLabel = INTENT_LABELS.includes(raw.intent) ? raw.intent : 'otro';

  // nivel_frustracion: clamp 0..3 entero
  const rawFrust = typeof raw.nivel_frustracion === 'number'
    ? raw.nivel_frustracion
    : parseInt(String(raw.nivel_frustracion ?? '0'), 10);
  const nivel_frustracion = (Math.min(3, Math.max(0, Math.trunc(
    Number.isFinite(rawFrust) ? rawFrust : 0,
  ))) as 0 | 1 | 2 | 3);

  // confianza: clamp 0..1
  const rawConf = typeof raw.confianza === 'number' ? raw.confianza : parseFloat(String(raw.confianza ?? '0'));
  const confianza = Number.isFinite(rawConf) ? Math.min(1, Math.max(0, rawConf)) : 0;

  // booleanos con coerción
  const quiere_continuar = Boolean(raw.quiere_continuar ?? true);
  const es_cierre = Boolean(raw.es_cierre ?? false);

  // slots_detectados: solo si es objeto plano (no array, no null)
  const slotsRaw = raw.slots_detectados;
  const slots_detectados: Record<string, string | number> =
    slotsRaw && typeof slotsRaw === 'object' && !Array.isArray(slotsRaw)
      ? (slotsRaw as Record<string, string | number>)
      : {};

  return { intent, quiere_continuar, nivel_frustracion, es_cierre, slots_detectados, confianza };
}

/**
 * Clasifica el mensaje entrante con IA.
 * Degrada con gracia: parse falla / LLM cuelga → fallback neutro.
 * Después del modelo: refuerzo regex de opt-out PISA el resultado si corresponde.
 */
export async function classifyIntent(
  ai: AILike,
  input: { text: string; ctx?: IntentContext; apiKey?: string; model?: string },
): Promise<IntentResult> {
  try {
    // Armar mensaje al modelo: historial reciente + contexto + mensaje actual
    const { text, ctx, apiKey, model } = input;

    const historyLines = (ctx?.history ?? [])
      .slice(-6) // máx 6 turnos de contexto
      .map((m) => `${m.role === 'user' ? 'Usuario' : 'Asistente'}: ${m.content}`)
      .join('\n');

    const areaLine = ctx?.area ? `Área detectada: ${ctx.area}` : '';
    const stateLine = ctx?.dialogueState
      ? `Estado actual: ${JSON.stringify(ctx.dialogueState)}`
      : '';

    const userMessage = [
      historyLines,
      areaLine,
      stateLine,
      `Último mensaje a clasificar: "${text}"`,
    ]
      .filter(Boolean)
      .join('\n');

    const raw = await ai.complete({
      systemPrompt: CLASSIFY_PROMPT,
      userMessage,
      jsonMode: true,
      temperature: 0,
      maxTokens: 300,
      apiKey,
      model,
    });

    // Parseo robusto (igual que ReceptionFichaBuilder)
    let parsed: any = {};
    try {
      const clean = String(raw).replace(/```json\n?/, '').replace(/```\n?$/, '').trim();
      parsed = JSON.parse(clean);
    } catch {
      parsed = {};
    }

    let result = sanitizeIntent(parsed);

    // Refuerzo server-side: opt-out regex PISA al modelo
    if (detectOptOut(text)) {
      result = {
        ...result,
        intent: 'opt_out',
        quiere_continuar: false,
        es_cierre: true,
      };
    }

    return result;
  } catch {
    // Si el LLM tira o cualquier cosa explota: fallback neutro, nunca throw
    return { ...NEUTRAL_FALLBACK };
  }
}

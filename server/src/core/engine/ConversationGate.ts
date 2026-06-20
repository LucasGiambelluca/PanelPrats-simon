// ─── ConversationGate ─────────────────────────────────────────────────────────
// Detector barato (SIN IA) que decide si el usuario sigue el flujo o se desvió.
// Solo cuando devuelve 'escalate' el motor invoca IA (gating de costo).
// Funciones puras: no toca DB ni red.

export const LONG_CHARS = 120;

// Palabras que delatan una pregunta/pedido de info (querer info ≠ fallar el paso).
const QUESTION_WORDS = [
  'como', 'cuando', 'donde', 'cuanto', 'cuanta', 'porque', 'atienden', 'atiende',
  'cuesta', 'precio', 'valor', 'horario', 'horarios', 'ubicad', 'queda', 'hacen',
  'sirve', 'puedo', 'puede', 'tienen', 'necesito saber',
];

export type GateDecision =
  | { decision: 'match'; value: string }
  | { decision: 'reprompt' }
  | { decision: 'escalate'; reason: 'question' | 'long' | 'retry_exhausted' };

const fold = (s: string) =>
  String(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\w\s]/gi, '').toLowerCase().trim();

/** Resuelve el input contra las opciones: exacto (fold) → fuzzy parcial → sinónimos. */
export function matchOption(
  input: string,
  options: string[],
  synonyms?: Record<string, string[]>,
): string | null {
  const ci = fold(input);
  if (!ci) return null;
  // 1. exacto / fuzzy parcial
  for (const o of options) {
    const co = fold(o);
    // exacto siempre; substring solo si ambos lados son largos (evita que opciones
    // cortas como "Sí"/"No" matcheen cualquier frase que las contenga: "sin causa" ⊃ "si").
    if (co && (co === ci || (ci.length > 2 && co.length > 3 && (co.includes(ci) || ci.includes(co))))) return o;
  }
  // 2. sinónimos declarados en el nodo
  if (synonyms) {
    for (const o of options) {
      for (const syn of synonyms[o] || []) {
        const cs = fold(syn);
        if (cs && (cs === ci || (ci.length > 2 && cs.length > 3 && (cs.includes(ci) || ci.includes(cs))))) return o;
      }
    }
  }
  return null;
}

export function isQuestion(input: string): boolean {
  if (input.includes('?') || input.includes('¿')) return true;
  const f = fold(input);
  return QUESTION_WORDS.some(w => f.includes(w));
}

export function isLong(input: string): boolean {
  if ((input || '').length > LONG_CHARS) return true;
  const sentences = (input || '').split(/[.?!]+/).map(s => s.trim()).filter(s => s.length > 3);
  return sentences.length >= 2;
}

export function evaluate(params: {
  input: string;
  expectedOptions: string[];
  retryCount: number;
  maxRetries?: number;
  synonyms?: Record<string, string[]>;
}): GateDecision {
  const { input, expectedOptions, retryCount, maxRetries = 1, synonyms } = params;

  const matched = matchOption(input, expectedOptions, synonyms);
  if (matched) return { decision: 'match', value: matched };

  if (isQuestion(input)) return { decision: 'escalate', reason: 'question' };
  if (isLong(input)) return { decision: 'escalate', reason: 'long' };

  if (retryCount < maxRetries) return { decision: 'reprompt' };
  return { decision: 'escalate', reason: 'retry_exhausted' };
}

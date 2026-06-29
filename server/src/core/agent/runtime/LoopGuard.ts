// LoopGuard — tope de llamadas IA por contacto para que el agente nunca entre
// en un loop interminable (contestar una y otra vez quemando API).
//
// Tres variantes, todas configurables por cuenta y combinables:
//   A) Ventana deslizante: maxCalls por windowMin (auto-resetea).
//   B) Tope total: windowMin=0 → nunca resetea (techo duro de la conversación).
//   C) Anti-eco: corta si repite una respuesta casi idéntica (echoGuard).
// Al tocar el tope aplica `action`: 'handoff' (deriva a humano), 'silence'
// (no responde) o 'cooldown' (frena hasta que pase la ventana).
//
// Módulo puro: sin I/O ni reloj propio. El caller inyecta `now` y persiste el estado.

export type LoopGuardAction = 'handoff' | 'silence' | 'cooldown';

export interface LoopGuardConfig {
  /** Si está apagado, nunca bloquea (comportamiento previo). */
  enabled: boolean;
  /** Máximo de llamadas IA permitidas dentro de la ventana. */
  maxCalls: number;
  /** Ventana deslizante en minutos. 0 = sin reset (tope total). */
  windowMin: number;
  /** Cortar si la respuesta repite una reciente casi idéntica. */
  echoGuard: boolean;
  /** Cuántas respuestas recientes mirar para detectar el eco. */
  echoLookback: number;
  /** Qué hacer al tocar el tope. */
  action: LoopGuardAction;
}

export interface LoopGuardState {
  /** Timestamps (ms) de cada llamada IA. */
  calls: number[];
  /** Últimas respuestas normalizadas (para anti-eco). */
  replies: string[];
}

export const DEFAULT_LOOP_GUARD: LoopGuardConfig = {
  enabled: true,
  maxCalls: 30,
  windowMin: 60,
  echoGuard: true,
  echoLookback: 3,
  action: 'handoff',
};

const ACTIONS: LoopGuardAction[] = ['handoff', 'silence', 'cooldown'];

/** Mergea la config cruda (jsonb de la cuenta) sobre los defaults y clampa lo inválido. */
export function normalizeLoopGuardConfig(raw: any): LoopGuardConfig {
  const r = (raw && typeof raw === 'object') ? raw : {};
  const intOr = (v: any, def: number, min: number) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(min, Math.floor(n)) : def;
  };
  return {
    enabled: typeof r.enabled === 'boolean' ? r.enabled : DEFAULT_LOOP_GUARD.enabled,
    maxCalls: intOr(r.maxCalls, DEFAULT_LOOP_GUARD.maxCalls, 1),
    windowMin: intOr(r.windowMin, DEFAULT_LOOP_GUARD.windowMin, 0),
    echoGuard: typeof r.echoGuard === 'boolean' ? r.echoGuard : DEFAULT_LOOP_GUARD.echoGuard,
    echoLookback: intOr(r.echoLookback, DEFAULT_LOOP_GUARD.echoLookback, 1),
    action: ACTIONS.includes(r.action) ? r.action : DEFAULT_LOOP_GUARD.action,
  };
}

/** Normaliza texto para comparar respuestas: minúsculas, sin espacios redundantes. */
export function normalizeReply(s: string): string {
  return String(s ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Llamadas vigentes en la ventana (todas si windowMin=0). */
function callsInWindow(state: LoopGuardState, config: LoopGuardConfig, now: number): number[] {
  const calls = state.calls ?? [];
  if (config.windowMin <= 0) return calls;
  const cutoff = now - config.windowMin * 60_000;
  return calls.filter((t) => t >= cutoff);
}

/** Decisión ANTES de llamar a la IA: ¿alcanzó el tope de llamadas? */
export function evaluateRate(state: LoopGuardState, config: LoopGuardConfig, now: number): { blocked: boolean } {
  if (!config.enabled) return { blocked: false };
  return { blocked: callsInWindow(state, config, now).length >= config.maxCalls };
}

/** Decisión sobre la respuesta candidata: ¿repite una reciente casi idéntica? */
export function isEchoReply(state: LoopGuardState, reply: string, config: LoopGuardConfig): boolean {
  if (!config.enabled || !config.echoGuard) return false;
  const norm = normalizeReply(reply);
  if (!norm) return false;
  return (state.replies ?? []).slice(-config.echoLookback).includes(norm);
}

/** Registra una llamada IA (purga lo viejo si hay ventana). Devuelve estado nuevo. */
export function recordCall(state: LoopGuardState, config: LoopGuardConfig, now: number): LoopGuardState {
  const kept = callsInWindow(state, config, now);
  return { calls: [...kept, now], replies: state.replies ?? [] };
}

/** Registra una respuesta enviada (normalizada, recortada a echoLookback). */
export function recordReply(state: LoopGuardState, config: LoopGuardConfig, reply: string): LoopGuardState {
  const replies = [...(state.replies ?? []), normalizeReply(reply)].slice(-config.echoLookback);
  return { calls: state.calls ?? [], replies };
}

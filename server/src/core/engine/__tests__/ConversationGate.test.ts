import { describe, it, expect } from 'vitest';
import { evaluate, matchOption, isQuestion, isLong } from '../ConversationGate';

const OPTS = ['Jubilación / ANSES', 'Despido / Trabajo', 'Otra consulta'];

describe('matchOption', () => {
  it('matchea exacto sin acentos', () => {
    expect(matchOption('jubilacion / anses', OPTS)).toBe('Jubilación / ANSES');
  });
  it('matchea parcial/fuzzy', () => {
    expect(matchOption('despido', OPTS)).toBe('Despido / Trabajo');
  });
  it('matchea por sinónimo del nodo', () => {
    expect(matchOption('me echaron', OPTS, { 'Despido / Trabajo': ['me echaron', 'despidieron'] }))
      .toBe('Despido / Trabajo');
  });
  it('devuelve null si no matchea', () => {
    expect(matchOption('xyz', OPTS)).toBeNull();
  });
  it('opción corta no matchea por substring accidental ("sin" ⊅ "Sí")', () => {
    expect(matchOption('me despidieron sin causa', ['Sí', 'No'])).toBeNull();
  });
  it('opción corta sigue matcheando exacto', () => {
    expect(matchOption('si', ['Sí', 'No'])).toBe('Sí');
  });
});

describe('isQuestion', () => {
  it('detecta signo de pregunta', () => {
    expect(isQuestion('atienden los sábados?')).toBe(true);
  });
  it('detecta palabra-pregunta sin signo', () => {
    expect(isQuestion('cuanto cuesta una consulta')).toBe(true);
  });
  it('no marca una respuesta normal', () => {
    expect(isQuestion('despido')).toBe(false);
  });
});

describe('isLong', () => {
  it('marca texto largo', () => {
    expect(isLong('a'.repeat(121))).toBe(true);
  });
  it('marca multi-oración', () => {
    expect(isLong('Hola. Me echaron del trabajo. Quiero saber qué hago.')).toBe(true);
  });
  it('no marca respuesta corta', () => {
    expect(isLong('jubilación')).toBe(false);
  });
});

describe('evaluate', () => {
  it('match → decision match con value canónico', () => {
    expect(evaluate({ input: 'despido', expectedOptions: OPTS, retryCount: 0 }))
      .toEqual({ decision: 'match', value: 'Despido / Trabajo' });
  });
  it('pregunta off-script → escalate(question) sin gastar reintento', () => {
    expect(evaluate({ input: '¿atienden sábados?', expectedOptions: OPTS, retryCount: 0 }))
      .toEqual({ decision: 'escalate', reason: 'question' });
  });
  it('texto largo → escalate(long)', () => {
    expect(evaluate({ input: 'hola '.repeat(40), expectedOptions: OPTS, retryCount: 0 }).decision)
      .toBe('escalate');
  });
  it('no-match con reintentos disponibles → reprompt', () => {
    expect(evaluate({ input: 'mmm no se', expectedOptions: OPTS, retryCount: 0 }))
      .toEqual({ decision: 'reprompt' });
  });
  it('no-match con reintentos agotados → escalate(retry_exhausted)', () => {
    expect(evaluate({ input: 'mmm no se', expectedOptions: OPTS, retryCount: 1 }))
      .toEqual({ decision: 'escalate', reason: 'retry_exhausted' });
  });
});

import { describe, it, expect } from 'vitest';
import { detectAskedTopic, clientAnswered, nextStreak, escalationDirective, slotDetected } from '../AskLoopGuard';

describe('detectAskedTopic', () => {
  it('detecta cada tema por keyword', () => {
    expect(detectAskedTopic('¿cuántos años de aportes tiene?')).toBe('aportes');
    expect(detectAskedTopic('¿tiene aportes por tareas insalubres?')).toBe('insalubres');
    expect(detectAskedTopic('¿es usted argentino o extranjero?')).toBe('nacionalidad');
    expect(detectAskedTopic('¿me dice su nombre?')).toBe('nombre');
    expect(detectAskedTopic('¿cuántos años tiene?')).toBe('edad');
    expect(detectAskedTopic('¿en qué zona vive?')).toBe('zona');
    expect(detectAskedTopic('¿a qué número lo contactamos?')).toBe('telefono');
    expect(detectAskedTopic('¿cuántos hijos tiene?')).toBe('hijos');
    expect(detectAskedTopic('¿cuál le queda más cómodo?')).toBe('horario');
  });
  it('no confunde una afirmación con una pregunta de dato', () => {
    expect(detectAskedTopic('Perfecto, queda agendado.')).toBeNull();
  });
  it('detecta nacionalidad con "argentino" pelado (fraseo más común)', () => {
    expect(detectAskedTopic('¿es argentino?')).toBe('nacionalidad');
    expect(detectAskedTopic('¿sos argentina?')).toBe('nacionalidad');
  });
});

describe('clientAnswered', () => {
  it('número responde aportes/edad', () => {
    expect(clientAnswered('aportes', 'como 25 años')).toBe(true);
    expect(clientAnswered('aportes', 'La Ferrere')).toBe(false);
    expect(clientAnswered('edad', 'tengo 61')).toBe(true);
  });
  it('sí/no responde insalubres', () => {
    expect(clientAnswered('insalubres', 'no, trabajé en un lavadero')).toBe(true);
    expect(clientAnswered('insalubres', 'mañana a la tarde')).toBe(false);
  });
  it('"no sé" NO cuenta como respuesta de insalubres (es la confusión que hay que cortar)', () => {
    expect(clientAnswered('insalubres', 'no sé nada de eso')).toBe(false);
    expect(clientAnswered('insalubres', 'no, nunca')).toBe(true);
  });
  it('aportes: "años en blanco" cuenta como respuesta', () => {
    expect(clientAnswered('aportes', 'trabajé 20 años en blanco')).toBe(true);
  });
  it('argentino/extranjero responde nacionalidad', () => {
    expect(clientAnswered('nacionalidad', 'soy argentino')).toBe(true);
    expect(clientAnswered('nacionalidad', 'no sé')).toBe(false);
  });
});

describe('slotDetected — alias de claves del classifier', () => {
  it('mapea las claves reales del classifier al AskTopic', () => {
    expect(slotDetected('aportes', { anios_aporte: 25 })).toBe(true);
    expect(slotDetected('horario', { hora: '15:30' })).toBe(true);
    expect(slotDetected('aportes', { aportes: 25 })).toBe(true); // alias canónico también
  });
  it('no matchea claves de otro tema', () => {
    expect(slotDetected('aportes', { zona: 'x' })).toBe(false);
    expect(slotDetected('horario', {})).toBe(false);
  });
});

describe('nextStreak', () => {
  it('mismo tema no respondido incrementa', () => {
    expect(nextStreak({ topic: 'aportes', count: 1 }, 'aportes', false)).toEqual({ topic: 'aportes', count: 2 });
  });
  it('respondido resetea a null', () => {
    expect(nextStreak({ topic: 'aportes', count: 3 }, 'aportes', true)).toBeNull();
  });
  it('tema nuevo arranca en 1', () => {
    expect(nextStreak({ topic: 'aportes', count: 2 }, 'nacionalidad', false)).toEqual({ topic: 'nacionalidad', count: 1 });
  });
  it('sin pregunta de dato (null) resetea', () => {
    expect(nextStreak({ topic: 'aportes', count: 2 }, null, true)).toBeNull();
  });
});

describe('escalationDirective', () => {
  it('count<2 → null', () => { expect(escalationDirective('aportes', 1)).toBeNull(); });
  it('count 2 → reformular simple', () => {
    expect(escalationDirective('aportes', 2)).toMatch(/reformul/i);
    expect(escalationDirective('aportes', 2)).toMatch(/aportes/);
  });
  it('count 3 → último intento', () => {
    expect(escalationDirective('aportes', 3)).toMatch(/ÚLTIMO|ultimo/i);
  });
  it('count>=4 → no preguntar más, a_confirmar/avanzar', () => {
    const d = escalationDirective('aportes', 4);
    expect(d).toMatch(/NO vuelvas a preguntar/i);
    expect(d).toMatch(/a_confirmar/);
  });
  it('count>=4 en tema NO decisivo (horario) no habla de gratis/pago', () => {
    const d = escalationDirective('horario', 4)!;
    expect(d).toMatch(/NO vuelvas a preguntar/i);
    expect(d).not.toMatch(/gratis/i);
    expect(d).not.toMatch(/pago/i);
    expect(d).not.toMatch(/a_confirmar/);
  });
});

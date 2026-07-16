import { describe, it, expect } from 'vitest';
import { textoRecordatorio } from '../ReminderScheduler';

// Bug prod 2026-07-16: el recordatorio salió "¡Hola, 27208676225498134!" — el
// nombre de la cita era el PSID de Instagram. Nunca saludar con un id numérico.
describe('textoRecordatorio', () => {
  it('con nombre real lo incluye', () => {
    expect(textoRecordatorio('Graciela', '12:15')).toContain('¡Hola, Graciela!');
  });
  it('con PSID como nombre saluda SIN nombre', () => {
    const t = textoRecordatorio('27208676225498134', '16:30');
    expect(t).not.toContain('27208676225498134');
    expect(t).toContain('¡Hola!');
  });
  it('sin nombre saluda sin nombre', () => {
    expect(textoRecordatorio(null, '10:00')).toContain('¡Hola!');
  });
});

import { describe, it, expect } from 'vitest';
import { phoneFromTranscript, areaToMotivo } from '../AppointmentAuditor';

describe('AppointmentAuditor — grounding puro', () => {
  it('phoneFromTranscript: extrae y normaliza el primer número AR válido', () => {
    const t = 'Cliente: mi tel es 11 2345-6789\nAsistente: gracias';
    expect(phoneFromTranscript(t)).toBe('541123456789');
  });

  it('phoneFromTranscript: null si no hay número válido', () => {
    expect(phoneFromTranscript('Cliente: hola\nAsistente: hola')).toBeNull();
  });

  it('areaToMotivo: mapea las áreas del AreaDetector a los motivos de la cita', () => {
    expect(areaToMotivo('jubilacion_mujer')).toBe('jubilacion');
    expect(areaToMotivo('pension_viudez')).toBe('pension_v');
    expect(areaToMotivo('laboral')).toBe('laboral');
    expect(areaToMotivo('art')).toBe('laboral');
    expect(areaToMotivo('transito')).toBe('otro');
    expect(areaToMotivo(null)).toBeNull();
  });
});

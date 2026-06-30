import { describe, it, expect } from 'vitest';
import { phoneFromTranscript, areaToMotivo } from '../AppointmentAuditor';
import { AppointmentAuditor } from '../AppointmentAuditor';

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

function fakeAi(json: any) {
  return { complete: async () => JSON.stringify(json) };
}
const baseAppt = {
  nombre: 'Juan Pérez', telefono: '5491133334444',
  start_time: '2026-07-02T13:00:00.000Z', end_time: '2026-07-02T13:30:00.000Z',
  oficina: 'Quilmes', motivo: 'jubilacion',
};

describe('AppointmentAuditor.audit', () => {
  it('sin transcript → sin_chat, sin revisar', async () => {
    const a = new AppointmentAuditor(fakeAi({ campos: [] }));
    const r = await a.audit({ appointment: baseAppt, transcript: '   ', channel: 'whatsapp', contactPhone: '5491133334444' });
    expect(r.sin_chat).toBe(true);
    expect(r.revisar).toBe(false);
  });

  it('todo coincide → revisar=false', async () => {
    const a = new AppointmentAuditor(fakeAi({ campos: [
      { campo: 'nombre', valor_cita: 'Juan Pérez', valor_chat: 'Juan Pérez', coincide: true, confianza: 0.9, sugerencia: null },
      { campo: 'motivo', valor_cita: 'jubilacion', valor_chat: 'jubilación', coincide: true, confianza: 0.9, sugerencia: null },
    ] }));
    const r = await a.audit({ appointment: baseAppt, transcript: 'Cliente: soy Juan Pérez, quiero jubilarme', channel: 'whatsapp', contactPhone: '5491133334444' });
    expect(r.revisar).toBe(false);
  });

  it('FB con telefono = id de red y número real en el chat → discrepancia teléfono (grounding pisa)', async () => {
    const a = new AppointmentAuditor(fakeAi({ campos: [] }));
    const r = await a.audit({
      appointment: { ...baseAppt, telefono: '24681012141618' },
      transcript: 'Cliente: mi WhatsApp es 11 2345-6789',
      channel: 'facebook',
      contactPhone: '24681012141618',
    });
    const tel = r.campos.find(c => c.campo === 'telefono')!;
    expect(tel.coincide).toBe(false);
    expect(tel.sugerencia).toBe('541123456789');
    expect(r.revisar).toBe(true);
  });

  it('IA falla (JSON inválido) → error, sin revisar', async () => {
    const a = new AppointmentAuditor({ complete: async () => 'no soy json' });
    const r = await a.audit({ appointment: baseAppt, transcript: 'Cliente: hola', channel: 'whatsapp', contactPhone: '5491133334444' });
    expect(r.error).toBeTruthy();
    expect(r.revisar).toBe(false);
  });
});

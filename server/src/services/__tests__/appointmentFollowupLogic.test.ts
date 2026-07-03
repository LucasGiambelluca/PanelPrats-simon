import { describe, it, expect } from 'vitest';
import { dueAppointmentEvents, fechaAR, horaAR } from '../appointmentFollowupLogic';

const CFG = { reminder24hEnabled: true, followupEnabled: true };
const H = 60 * 60 * 1000;
const iso = (ms: number) => new Date(ms).toISOString();

describe('dueAppointmentEvents', () => {
  const now = Date.parse('2026-07-08T12:00:00.000Z');

  it('reminder_24h: cita en <24h, no enviado → dispara', () => {
    const a = { status: 'confirmada', start_time: iso(now + 20 * H), reminder_24h_sent: false, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).toContain('reminder_24h');
  });
  it('reminder_24h: cita a >24h → NO dispara', () => {
    const a = { status: 'confirmada', start_time: iso(now + 30 * H), reminder_24h_sent: false, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).not.toContain('reminder_24h');
  });
  it('reminder_24h: ya enviado → NO dispara', () => {
    const a = { status: 'confirmada', start_time: iso(now + 5 * H), reminder_24h_sent: true, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).not.toContain('reminder_24h');
  });
  it('followup: 24h después del turno, no enviado → dispara', () => {
    const a = { status: 'asistio', start_time: iso(now - 25 * H), reminder_24h_sent: true, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).toContain('followup');
  });
  it('followup: solo 10h después → NO dispara todavía', () => {
    const a = { status: 'asistio', start_time: iso(now - 10 * H), reminder_24h_sent: true, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).not.toContain('followup');
  });
  it('cancelada → ningún evento', () => {
    const a = { status: 'cancelada', start_time: iso(now - 25 * H), reminder_24h_sent: false, followup_sent: false };
    expect(dueAppointmentEvents(a, now, CFG)).toEqual([]);
  });
  it('flags apagados → nada aunque corresponda', () => {
    const a = { status: 'asistio', start_time: iso(now - 25 * H), reminder_24h_sent: false, followup_sent: false };
    expect(dueAppointmentEvents(a, now, { reminder24hEnabled: false, followupEnabled: false })).toEqual([]);
  });
});

describe('formato AR', () => {
  it('horaAR devuelve HH:mm en zona AR', () => {
    // 2026-07-08T18:30:00Z = 15:30 AR (UTC-3)
    expect(horaAR('2026-07-08T18:30:00.000Z')).toBe('15:30');
  });
  it('fechaAR devuelve día/mes', () => {
    expect(fechaAR('2026-07-08T18:30:00.000Z')).toMatch(/8\/7/);
  });
});

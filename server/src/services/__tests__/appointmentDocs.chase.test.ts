import { describe, it, expect } from 'vitest';
import { docChaseDue } from '../appointmentFollowupLogic';

const CFG = { docChaseEnabled: true, everyDays: 3, max: 3 };
const D = 24 * 60 * 60 * 1000;
const now = Date.parse('2026-07-20T12:00:00.000Z');
const iso = (ms: number) => new Date(ms).toISOString();

describe('docChaseDue', () => {
  it('con docs pendientes, follow-up ya hecho, pasó la cadencia → dispara', () => {
    const a = { status: 'asistio', followup_sent: true, doc_chase_count: 1, doc_chase_last_at: iso(now - 4 * D) };
    expect(docChaseDue(a, 2, now, CFG)).toBe(true);
  });
  it('sin docs pendientes → no dispara', () => {
    const a = { status: 'asistio', followup_sent: true, doc_chase_count: 1, doc_chase_last_at: iso(now - 4 * D) };
    expect(docChaseDue(a, 0, now, CFG)).toBe(false);
  });
  it('cadencia no cumplida (último chase hace 1 día) → no dispara', () => {
    const a = { status: 'asistio', followup_sent: true, doc_chase_count: 1, doc_chase_last_at: iso(now - 1 * D) };
    expect(docChaseDue(a, 2, now, CFG)).toBe(false);
  });
  it('alcanzó el máximo → no dispara', () => {
    const a = { status: 'asistio', followup_sent: true, doc_chase_count: 3, doc_chase_last_at: iso(now - 10 * D) };
    expect(docChaseDue(a, 2, now, CFG)).toBe(false);
  });
  it('follow-up todavía no hecho → no dispara (el chase empieza después del follow-up)', () => {
    const a = { status: 'asistio', followup_sent: false, doc_chase_count: 0, doc_chase_last_at: null };
    expect(docChaseDue(a, 2, now, CFG)).toBe(false);
  });
  it('docs agregados después del follow-up (sin last_at) → dispara', () => {
    const a = { status: 'asistio', followup_sent: true, doc_chase_count: 0, doc_chase_last_at: null };
    expect(docChaseDue(a, 1, now, CFG)).toBe(true);
  });
  it('cancelada → no dispara', () => {
    const a = { status: 'cancelada', followup_sent: true, doc_chase_count: 1, doc_chase_last_at: iso(now - 10 * D) };
    expect(docChaseDue(a, 2, now, CFG)).toBe(false);
  });
});

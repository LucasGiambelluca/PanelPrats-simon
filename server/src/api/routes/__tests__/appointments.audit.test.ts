import { describe, it, expect, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

vi.mock('../../../services/AppointmentService', () => ({
  AppointmentService: {
    list: async () => ([{ id: 'a1', account_id: 'acc1', phone: 'PSID1', telefono: 'PSID1', nombre: 'Juan', motivo: 'jubilacion', start_time: '2026-07-02T13:00:00Z', oficina: 'Quilmes' }]),
    getById: async () => ({ id: 'a1', account_id: 'acc1', phone: 'PSID1', telefono: 'PSID1' }),
    saveAudit: vi.fn(async () => {}),
    resolveAuditField: vi.fn(async () => {}),
    update: vi.fn(async () => ({ id: 'a1' })),
  },
}));
vi.mock('../../../services/MessageStore', () => ({
  messageStore: { getTranscript: async () => 'Cliente: mi tel es 11 2345-6789' },
}));
vi.mock('../../../config/supabase', () => ({
  supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { channel: 'facebook' }, error: null }) }) }) }) },
}));
vi.mock('../../../services/AIService', () => ({
  AIService: { complete: async () => JSON.stringify({ campos: [] }) },
}));

import { appointmentsRouter } from '../appointments.routes';

function app() {
  const a = express();
  a.use(express.json());
  a.use((req: any, _r: any, n: any) => { req.user = { id: 'u1', role: 'admin' }; n(); });
  a.use('/api/appointments', appointmentsRouter());
  return a;
}

describe('POST /api/appointments/audit', () => {
  it('audita las citas y devuelve resumen', async () => {
    const res = await request(app()).post('/api/appointments/audit').send({ account_id: 'acc1' });
    expect(res.status).toBe(200);
    expect(res.body.audited).toBe(1);
    expect(res.body.flagged).toBeGreaterThanOrEqual(1);
  });
});

describe('POST /api/appointments/:id/audit/apply', () => {
  it('aplica la sugerencia de teléfono y marca resuelto', async () => {
    const { AppointmentService } = await import('../../../services/AppointmentService');
    (AppointmentService.getById as any) = async () => ({
      id: 'a1', account_id: 'acc1', phone: 'PSID1', telefono: 'PSID1',
      audit_json: { revisar: true, campos: [{ campo: 'telefono', coincide: false, confianza: 0.95, sugerencia: '541123456789' }] },
    });
    const res = await request(app()).post('/api/appointments/a1/audit/apply').send({ campo: 'telefono' });
    expect(res.status).toBe(200);
    expect(AppointmentService.update).toHaveBeenCalledWith('a1', { telefono: '541123456789' });
    expect(AppointmentService.resolveAuditField).toHaveBeenCalledWith('a1', 'telefono');
  });

  it('rechaza teléfono sugerido inválido con 400', async () => {
    const { AppointmentService } = await import('../../../services/AppointmentService');
    (AppointmentService.getById as any) = async () => ({
      id: 'a1', account_id: 'acc1', phone: 'PSID1',
      audit_json: { campos: [{ campo: 'telefono', coincide: false, confianza: 0.9, sugerencia: 'no-numero' }] },
    });
    const res = await request(app()).post('/api/appointments/a1/audit/apply').send({ campo: 'telefono' });
    expect(res.status).toBe(400);
  });
});

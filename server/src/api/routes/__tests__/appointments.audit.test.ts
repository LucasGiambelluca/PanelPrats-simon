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

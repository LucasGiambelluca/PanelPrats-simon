import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';

const calls: any[] = [];

vi.mock('../../config/supabase', () => ({
  supabase: {
    from: () => ({
      update: (patch: any) => { calls.push(patch); return { eq: () => Promise.resolve({ error: null }) }; },
    }),
  },
}));

// AppointmentService reads process.env at module load to set isSupabaseConfigured.
// Set env, reset modules, then dynamically import so the module re-evaluates with
// isSupabaseConfigured = true (so the Supabase branch is exercised).
let AppointmentService: typeof import('../AppointmentService').AppointmentService;

beforeAll(async () => {
  process.env.SUPABASE_URL = 'https://real.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'service-key-real';
  vi.resetModules();
  const mod = await import('../AppointmentService');
  AppointmentService = mod.AppointmentService;
});

describe('AppointmentService.saveAudit', () => {
  beforeEach(() => { calls.length = 0; });

  it('persiste audit_json + audit_at', async () => {
    await AppointmentService.saveAudit('appt1', { revisar: true, campos: [], sin_chat: false } as any);
    expect(calls[0]).toMatchObject({ audit_json: { revisar: true } });
    expect(calls[0].audit_at).toBeTruthy();
  });
});

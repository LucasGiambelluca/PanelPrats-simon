import { describe, it, expect, vi, beforeAll } from 'vitest';

let insertError: any = null;

// Mocked supabase client — always returns the controlled insertError.
vi.mock('../../config/supabase', () => ({
  supabase: {
    from: () => ({
      insert: () => ({
        select: () => ({
          single: () => Promise.resolve({ data: null, error: insertError }),
        }),
      }),
      select: () => ({
        order: () => ({
          eq: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// AppointmentService reads process.env at module load to set isSupabaseConfigured.
// We must set env, reset modules, then dynamically import so the module re-evaluates
// with isSupabaseConfigured = true (so the Supabase branch is exercised).
let AppointmentService: typeof import('../AppointmentService').AppointmentService;

beforeAll(async () => {
  process.env.SUPABASE_URL = 'https://test.supabase.co';
  process.env.SUPABASE_SERVICE_KEY = 'test-service-key';
  vi.resetModules();
  const mod = await import('../AppointmentService');
  AppointmentService = mod.AppointmentService;
});

describe('AppointmentService.create — error del trigger de capacidad', () => {
  it('mapea office_capacity_full → SLOT_TAKEN', async () => {
    insertError = { code: 'P0001', message: 'office_capacity_full' };
    await expect(
      AppointmentService.create({
        account_id: 'acc1',
        phone: 'p',
        telefono: 'p',
        nombre: 'Ana',
        resumen: '',
        status: 'pendiente',
        start_time: '2026-06-22T13:00:00Z',
        end_time: '2026-06-22T14:00:00Z',
        oficina: 'CABA',
      } as any)
    ).rejects.toThrow('SLOT_TAKEN');
  });
});

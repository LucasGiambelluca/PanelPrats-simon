import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock controlable de axios.get: cada test setea la respuesta/error.
const get = vi.fn();
vi.mock('axios', () => ({ default: { get: (...a: any[]) => get(...a) } }));

import { validateMetaToken } from '../validateMetaToken';

beforeEach(() => { get.mockReset(); });

describe('validateMetaToken — WhatsApp Cloud API', () => {
  it('OK: valida pidiendo el phone_number_id (no compara profile_id)', async () => {
    // El token es del WABA/System User; su id NO es el phone_number_id. La validación
    // correcta es que GET /{phone_number_id} responda 200 con ese token.
    get.mockResolvedValueOnce({ data: { id: '1085242301348371', display_phone_number: '+54 9 11', verified_name: 'Linea consultas' } });

    const res = await validateMetaToken({ channel: 'whatsapp', externalId: '1085242301348371', accessToken: 'EAAxToken' });

    expect(res.ok).toBe(true);
    expect(res.info).toMatchObject({ type: 'WHATSAPP_CLOUD', phone: '+54 9 11', name: 'Linea consultas' });
    // Pidió el teléfono, NO debug_token.
    expect(get.mock.calls[0][0]).toContain('/1085242301348371');
  });

  it('NO compara el id del token contra el phone_number_id (sin falso negativo)', async () => {
    // Antes: debug_token devolvía profile_id 122099551353337343 != external_id → falso "OTRO ID".
    get.mockResolvedValueOnce({ data: { id: '1085242301348371', display_phone_number: '+54 9 11' } });

    const res = await validateMetaToken({ channel: 'whatsapp', externalId: '1085242301348371', accessToken: 'EAAxToken' });

    expect(res.ok).toBe(true);
  });

  it('FALLA: token vencido (code 190)', async () => {
    get.mockRejectedValueOnce({ response: { data: { error: { code: 190, message: 'expired' } } } });

    const res = await validateMetaToken({ channel: 'whatsapp', externalId: '1085242301348371', accessToken: 'bad' });

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/190/);
  });

  it('FALLA: token sin acceso a ese teléfono (code 100/200)', async () => {
    get.mockRejectedValueOnce({ response: { data: { error: { code: 200, message: 'no access' } } } });

    const res = await validateMetaToken({ channel: 'whatsapp', externalId: '999', accessToken: 'otra-app' });

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/999/);
  });
});

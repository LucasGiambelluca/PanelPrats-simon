import { describe, it, expect, vi } from 'vitest';
import { extractMemoryPatch } from '../MemoryUpdater';

describe('extractMemoryPatch', () => {
  it('arma el prompt de extracción y parsea el JSON del modelo', async () => {
    const ai = { complete: vi.fn().mockResolvedValue('{"profile":{"nombre":"María","edad":63},"preferences":{},"summary":"Consultó moratoria."}') };
    const patch = await extractMemoryPatch(ai as any, [
      { role: 'user', content: 'soy maría tengo 63' },
      { role: 'assistant', content: 'hola maría' },
    ]);
    expect(patch.profile).toMatchObject({ nombre: 'María', edad: 63 });
    expect(patch.summary).toContain('moratoria');
  });

  it('devuelve patch vacío si el modelo no da JSON válido', async () => {
    const ai = { complete: vi.fn().mockResolvedValue('no soy json') };
    const patch = await extractMemoryPatch(ai as any, [{ role: 'user', content: 'hola' }]);
    expect(patch).toEqual({ profile: {}, preferences: {}, summary: null });
  });
});

import { describe, it, expect } from 'vitest';
import { buildTemplate, TEMPLATES } from '../whatsappTemplates';

describe('whatsappTemplates', () => {
  it('reminder_24h arma components y preview con los 4 params en orden', () => {
    const r = buildTemplate('reminder_24h', ['María', 'martes 8/7', '15:30', 'Sede Centro']);
    expect(r.name).toBe(TEMPLATES.reminder_24h.metaName);
    expect(r.lang).toBe(TEMPLATES.reminder_24h.lang);
    expect(r.components).toEqual([
      { type: 'body', parameters: [
        { type: 'text', text: 'María' },
        { type: 'text', text: 'martes 8/7' },
        { type: 'text', text: '15:30' },
        { type: 'text', text: 'Sede Centro' },
      ] },
    ]);
    expect(r.preview).toContain('María');
    expect(r.preview).toContain('15:30');
  });

  it('seguimiento usa 1 param', () => {
    const r = buildTemplate('seguimiento', ['Juan']);
    expect(r.components[0].parameters).toEqual([{ type: 'text', text: 'Juan' }]);
    expect(r.preview).toContain('Juan');
  });

  it('docs_pendientes mete la lista de docs como 2do param', () => {
    const r = buildTemplate('docs_pendientes', ['Ana', 'DNI, recibos']);
    expect(r.components[0].parameters[1]).toEqual({ type: 'text', text: 'DNI, recibos' });
  });

  it('rechaza cantidad de params incorrecta', () => {
    expect(() => buildTemplate('reminder_24h', ['solo uno'])).toThrow();
  });
});

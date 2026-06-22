import { describe, it, expect } from 'vitest';
import { buildPersona } from '../AgentPersona';

describe('buildPersona', () => {
  const account = { accountId: 'acc1', agentName: 'Sofía', businessContext: 'Estudio previsional PYS', estudioNombre: 'PYS' } as any;

  it('incluye identidad, tono, grounding y la ficha del contacto', () => {
    const prompt = buildPersona(account, 'FICHA: María, 63. Consultó moratoria.');
    expect(prompt).toContain('Sofía');
    expect(prompt).toContain('PYS');
    expect(prompt).toContain('FICHA: María, 63');
    expect(prompt.toLowerCase()).toContain('search_knowledge'); // regla de grounding
    expect(prompt.toLowerCase()).toContain('confirm');           // confirmar antes de mutar
  });

  it('usa el default Sofía si no hay agentName', () => {
    const prompt = buildPersona({ accountId: 'acc1' } as any, 'FICHA: nuevo.');
    expect(prompt).toContain('Sofía');
  });

  it('incluye reglas de agendado por oficina (list_offices + dirección)', () => {
    const prompt = buildPersona({ accountId: 'acc1', agentName: 'Sofía' } as any, 'FICHA: nuevo.');
    expect(prompt.toLowerCase()).toContain('list_offices');
    expect(prompt.toLowerCase()).toContain('direcc'); // dar la dirección al confirmar
  });
});

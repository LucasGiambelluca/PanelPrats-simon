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
    expect(prompt.toLowerCase()).toContain('confirm');           // confirmar antes de cancelar/reprogramar
  });

  it('usa el default Sofía si no hay agentName', () => {
    const prompt = buildPersona({ accountId: 'acc1' } as any, 'FICHA: nuevo.');
    expect(prompt).toContain('Sofía');
  });

  it('agendar un turno se delega en start_booking (flujo determinístico)', () => {
    const prompt = buildPersona({ accountId: 'acc1', agentName: 'Sofía' } as any, 'FICHA: nuevo.');
    expect(prompt.toLowerCase()).toContain('start_booking');
    // No debe instruir la receta manual paso-numerado (que competía con el flujo guiado).
    expect(prompt).not.toMatch(/1\)\s*usá list_offices/i);
  });

  it('instruye registrar la calificación y usar la CALIFICACIÓN PREVIA', () => {
    const prompt = buildPersona({ accountId: 'acc1', agentName: 'Sofía' } as any, 'FICHA: nuevo.');
    expect(prompt.toLowerCase()).toContain('set_qualification');
    expect(prompt.toUpperCase()).toContain('CALIFICACIÓN PREVIA');
  });

  it('inyecta PROCEDIMIENTOS cuando la cuenta los tiene', () => {
    const prompt = buildPersona(
      { accountId: 'acc1', agentName: 'Sofía', agentProcedures: 'Despido: preguntá hace cuánto y la edad.' } as any,
      'FICHA: nuevo.',
    );
    expect(prompt.toUpperCase()).toContain('PROCEDIMIENTOS');
    expect(prompt).toContain('preguntá hace cuánto');
  });
});

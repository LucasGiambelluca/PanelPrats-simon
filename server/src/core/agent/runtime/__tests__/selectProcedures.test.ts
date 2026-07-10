import { describe, it, expect } from 'vitest';
import { selectProcedures } from '../selectProcedures';

// El blob real de agent_procedures (~43k chars) entra ENTERO al system prompt en
// cada turno, diluyendo las instrucciones (peor aún en gpt-4o-mini de FB/IG).
// Con el área de la conversación conocida, solo van las secciones de ESA área +
// las generales (recepción, extracción, etc.).

const BLOB = [
  'Intro sin header (siempre va).',
  '## Recepción y derivación de consultas',
  'Reglas de recepción. Tratar de usted.',
  '## Jubilación (general)',
  'Reglas comunes de jubilación.',
  '## Jubilación — Hombre',
  'Preguntar edad e insalubres.',
  '## Jubilación — Mujer',
  'Preguntar edad e hijos.',
  '## Pensión por viudez',
  'Preguntar fallecimiento del cónyuge.',
  '## Laboral / Despido',
  'Preguntar antigüedad.',
  '## ART / Accidente de trabajo',
  'Preguntar accidente.',
  '## Accidente de tránsito',
  'Preguntar choque.',
  '## Extraccion de informacion',
  'Reglas de extracción (siempre van).',
].join('\n');

describe('selectProcedures — poda del libreto por área', () => {
  it('sin área → devuelve el texto completo intacto', () => {
    expect(selectProcedures(BLOB, null)).toBe(BLOB);
    expect(selectProcedures(BLOB, undefined)).toBe(BLOB);
  });

  it('área jubilacion_mujer → mujer + jubilación general + secciones generales; SIN hombre/laboral/art', () => {
    const out = selectProcedures(BLOB, 'jubilacion_mujer');
    expect(out).toContain('Preguntar edad e hijos.');
    expect(out).toContain('Reglas comunes de jubilación.');
    expect(out).toContain('Reglas de recepción.');
    expect(out).toContain('Reglas de extracción');
    expect(out).toContain('Intro sin header');
    expect(out).not.toContain('Preguntar edad e insalubres.');
    expect(out).not.toContain('Preguntar antigüedad.');
    expect(out).not.toContain('Preguntar accidente.');
  });

  it('área jubilacion (sexo aún desconocido) → TODAS las secciones de jubilación, sin otras áreas', () => {
    const out = selectProcedures(BLOB, 'jubilacion');
    expect(out).toContain('Preguntar edad e insalubres.');
    expect(out).toContain('Preguntar edad e hijos.');
    expect(out).not.toContain('Preguntar antigüedad.');
  });

  it('área laboral → laboral + generales; sin jubilación ni tránsito', () => {
    const out = selectProcedures(BLOB, 'laboral');
    expect(out).toContain('Preguntar antigüedad.');
    expect(out).toContain('Reglas de recepción.');
    expect(out).not.toContain('Reglas comunes de jubilación.');
    expect(out).not.toContain('Preguntar choque.');
  });

  it('área art y transito no se pisan entre sí', () => {
    expect(selectProcedures(BLOB, 'art')).toContain('Preguntar accidente.');
    expect(selectProcedures(BLOB, 'art')).not.toContain('Preguntar choque.');
    expect(selectProcedures(BLOB, 'transito')).toContain('Preguntar choque.');
    expect(selectProcedures(BLOB, 'transito')).not.toContain('Preguntar accidente.');
  });

  it('sección con header desconocido/custom → se incluye siempre (general)', () => {
    const custom = BLOB + '\n## Política de reintegros\nSiempre visible.';
    expect(selectProcedures(custom, 'laboral')).toContain('Siempre visible.');
  });

  it('área desconocida (no mapeada) → texto completo (fail-safe)', () => {
    expect(selectProcedures(BLOB, 'area_rara')).toBe(BLOB);
  });
});

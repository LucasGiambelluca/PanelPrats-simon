// Poda del libreto (agent_procedures) por ÁREA de la conversación.
//
// El blob completo (~43k chars) entraba ENTERO al system prompt en cada turno:
// ~11k tokens que diluyen las instrucciones (peor en gpt-4o-mini de FB/IG).
// Con el área conocida (DialogueState/AreaDetector) solo van las secciones de
// ESA área + las generales (recepción, extracción, cualquier header no mapeado).
//
// El blob se secciona con headers markdown '## '. Una sección es "de área" si su
// header matchea un área conocida; si no, es general y va siempre. Sin área (o
// área no mapeada) se devuelve el texto completo: fail-safe, nunca menos contexto
// del que había antes.

const AREAS = ['jubilacion', 'jubilacion_hombre', 'jubilacion_mujer', 'pension_viudez', 'laboral', 'art', 'transito'] as const;

const deaccent = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

/** Áreas a las que aplica un header de sección; null = sección general (va siempre). */
function areasForHeader(header: string): string[] | null {
  const h = deaccent(header);
  if (h.includes('jubilacion')) {
    if (h.includes('hombre')) return ['jubilacion_hombre', 'jubilacion'];
    if (h.includes('mujer')) return ['jubilacion_mujer', 'jubilacion'];
    return ['jubilacion', 'jubilacion_hombre', 'jubilacion_mujer'];
  }
  if (h.includes('pension')) return ['pension_viudez'];
  if (h.includes('laboral') || h.includes('despido')) return ['laboral'];
  if (/\bart\b/.test(h) || h.includes('accidente de trabajo')) return ['art'];
  if (h.includes('transito')) return ['transito'];
  return null; // general
}

export function selectProcedures(procedures: string, area?: string | null): string {
  if (!area || !(AREAS as readonly string[]).includes(area)) return procedures;

  const lines = procedures.split('\n');
  const out: string[] = [];
  let keep = true; // el preámbulo (antes del primer header) siempre va
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      const areas = areasForHeader(line.replace(/^##\s+/, ''));
      keep = areas === null || areas.includes(area);
    }
    if (keep) out.push(line);
  }
  return out.join('\n');
}

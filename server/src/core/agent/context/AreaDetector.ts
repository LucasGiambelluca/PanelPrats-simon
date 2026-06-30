// Clasificación DETERMINÍSTICA (regex) del área de la consulta. Se usa para que el
// gate de agendado NO saltee el procedimiento de calificación del libreto: si el
// mensaje toca un área, manda el LLM/libreto (que califica antes de agendar).
// Todas las áreas que devuelve este detector REQUIEREN calificación.

export type AreaKey =
  | 'jubilacion_hombre'
  | 'jubilacion_mujer'
  | 'jubilacion'
  | 'pension_viudez'
  | 'laboral'
  | 'art'
  | 'transito';

function norm(s: string): string {
  return (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
}

export function detectArea(text: string): AreaKey | null {
  const t = norm(text);
  if (!t) return null;

  // Orden de prioridad: específicos antes que genéricos.
  // `me\s+choc` es prefijo a propósito (chocaron / chocó / chocamos): NO le pongas \b al final.
  if (/\baccidente\s+de\s+transito\b|\bme\s+choc|\bchoque\b|\bsiniestro\b/.test(t)) return 'transito';
  if (/\bart\b|\baccidente\s+(laboral|de\s+trabajo|en\s+el\s+trabajo)\b/.test(t)) return 'art';
  if (/\b(pension|viudez|viuda|viudo|fallecio|fallecieron|falleci)\b/.test(t)) return 'pension_viudez';
  if (/\b(despido|despidieron|me\s+echaron|indemnizacion|reclamo\s+laboral|laboral|en\s+negro)\b/.test(t)) return 'laboral';

  // `jubilar` ya prefija jubilarme/jubilarse; `jubilaci` cubre jubilacion/jubilación.
  if (/\b(jubilaci|jubilar|jubilo)/.test(t)) {
    if (/\b(mujer|femenino|senora|sra|esposa|mama)\b/.test(t)) return 'jubilacion_mujer';
    if (/\b(hombre|masculino|senor|sr|esposo|papa)\b/.test(t)) return 'jubilacion_hombre';
    return 'jubilacion';
  }
  return null;
}

// ─── QualificationRules ───────────────────────────────────────────────────────
// Validación DURA de la calificación según el libreto del estudio. El LLM hace las
// preguntas; este módulo rechaza resultados incompletos o contradictorios para que
// el modelo tenga que completar el procedimiento (evidencia: hombre de 62 calificado
// "gratis" sin preguntarle insalubres). Funciones puras, sin IA, sin reloj interno.

export type QualCheck = { ok: true } | { ok: false; error: string };

export const QUALIFICATION_AREAS = new Set(['jubilacion', 'jubilacion_hombre', 'jubilacion_mujer']);

export function validateQualification(area: string, resultado: string, datos: Record<string, any>): QualCheck {
  if (!QUALIFICATION_AREAS.has(area)) return { ok: true };
  // Solo "gratis" tiene reglas duras; "pago"/"descartar" son el fallback seguro y no se validan.
  if (resultado !== 'gratis') return { ok: true };

  const edad = Number(datos.edad);
  if (!Number.isFinite(edad) || edad <= 0) {
    return { ok: false, error: 'Falta la edad: preguntala antes de registrar la calificación.' };
  }

  if (area === 'jubilacion' && resultado === 'gratis') {
    return { ok: false, error: 'Determiná primero el género (por el nombre o preguntando) y registrá jubilacion_hombre o jubilacion_mujer.' };
  }

  if (area === 'jubilacion_hombre' && resultado === 'gratis') {
    if (edad < 63 && datos.insalubres !== true) {
      return { ok: false, error: 'Hombre menor de 63: antes de calificar gratis preguntá si tiene aportes por tareas insalubres y pasá insalubres:true/false. Si no tiene, el resultado es "pago".' };
    }
    if (datos.nacionalidad !== 'argentino' && datos.nacionalidad !== 'extranjero') {
      return { ok: false, error: 'Falta la nacionalidad: preguntá si es argentino o extranjero antes de calificar gratis.' };
    }
    if (datos.nacionalidad === 'extranjero' && !(Number(datos.anio_ingreso) <= 2008)) {
      return { ok: false, error: 'Extranjero: solo califica gratis con año de ingreso (según DNI) 2008 o anterior. Preguntá el año y pasalo en anio_ingreso; si es 2009 o posterior, el resultado es "pago".' };
    }
  }

  if (area === 'jubilacion_mujer' && resultado === 'gratis') {
    const porEdad = edad >= 64 || (edad >= 58 && edad <= 59);
    if (!porEdad) {
      if (edad >= 60 && edad <= 63) {
        if (!Number.isFinite(Number(datos.aportes_aprox))) {
          return { ok: false, error: 'Mujer de 60 a 63: preguntá cuántos hijos tiene y los años de aportes aproximados antes de calificar (pasá aportes_aprox).' };
        }
        if (Number(datos.aportes_aprox) <= 19) {
          return { ok: false, error: 'Mujer de 60 a 63 con 19 años de aportes o menos NO califica gratis: registrá resultado "pago" (análisis previsional).' };
        }
      } else {
        return { ok: false, error: `Mujer de ${edad} años no califica gratis por edad: registrá resultado "pago" (análisis previsional).` };
      }
    }
  }

  return { ok: true };
}

/** ¿Hay calificación vigente (dentro del TTL) para el área? "jubilacion" acepta hombre/mujer. */
export function hasCalificacionVigente(
  cal: Record<string, any> | null | undefined,
  area: string,
  ttlDays: number,
  now: number,
): boolean {
  if (!cal) return false;
  const keys = area.startsWith('jubilacion')
    ? ['jubilacion_hombre', 'jubilacion_mujer', 'jubilacion']
    : [area];
  return keys.some((k) => {
    const e = cal[k];
    if (!e?.calificado_at) return false;
    const t = new Date(e.calificado_at).getTime();
    return Number.isFinite(t) && now - t >= 0 && now - t <= ttlDays * 86_400_000;
  });
}

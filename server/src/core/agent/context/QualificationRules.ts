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

  // "a confirmar": el anti-loop deja agendar gratis cuando el cliente no da un dato DECISOR
  // (aportes, insalubres, nacionalidad, anio_ingreso). Afloja SOLO chequeos que fallan por
  // FALTA de ese dato; nunca la edad ni un dato PRESENTE que descalifica (aportes<=19 sigue pago).
  const aConf = new Set<string>(Array.isArray(datos.a_confirmar) ? datos.a_confirmar.map(String) : []);

  if (area === 'jubilacion') {
    return { ok: false, error: 'Determiná primero el género (por el nombre o preguntando) y registrá jubilacion_hombre o jubilacion_mujer.' };
  }

  if (area === 'jubilacion_hombre') {
    // El piso de edad para insalubres lo evalúa el abogado; acá solo exigimos que la pregunta se haya hecho.
    const insalubres = datos.insalubres === true || datos.insalubres === 'true';
    if (edad < 63 && !insalubres && !aConf.has('insalubres')) {
      return { ok: false, error: 'Hombre menor de 63: antes de calificar gratis preguntá si tiene aportes por tareas insalubres y pasá insalubres:true/false. Si no tiene, el resultado es "pago".' };
    }
    if (datos.nacionalidad !== 'argentino' && datos.nacionalidad !== 'extranjero' && !aConf.has('nacionalidad')) {
      return { ok: false, error: 'Falta la nacionalidad: preguntá si es argentino o extranjero antes de calificar gratis.' };
    }
    // anio_ingreso es MIXTO: a_confirmar solo afloja el caso FALTANTE; un año PRESENTE 2009+
    // descalifica siempre (como aportes<=19). El guard duro no puede aflojar una contradicción.
    if (datos.nacionalidad === 'extranjero') {
      const anio = Number(datos.anio_ingreso);
      if (!Number.isFinite(anio) && !aConf.has('anio_ingreso')) {
        return { ok: false, error: 'Extranjero: preguntá el año de ingreso (según DNI) y pasalo en anio_ingreso. Si es 2009 o posterior, el resultado es "pago".' };
      }
      if (Number.isFinite(anio) && anio > 2008) {
        return { ok: false, error: 'Extranjero con año de ingreso 2009 o posterior NO califica gratis: registrá resultado "pago".' };
      }
    }
  }

  if (area === 'jubilacion_mujer') {
    const porEdad = edad >= 64 || (edad >= 58 && edad <= 59);
    if (!porEdad) {
      if (edad >= 60 && edad <= 63) {
        if (!Number.isFinite(Number(datos.aportes_aprox)) && !aConf.has('aportes')) {
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

/** Entrada de calificación VIGENTE (dentro del TTL) para el área, o null. 'jubilacion' acepta hombre/mujer. */
export function pickVigenteCalificacion(
  cal: Record<string, any> | null | undefined, area: string | null, ttlDays: number, now: number,
): { area: string; entry: any } | null {
  if (!cal || !area) return null;
  const keys = area.startsWith('jubilacion') ? ['jubilacion_hombre', 'jubilacion_mujer', 'jubilacion'] : [area];
  for (const k of keys) {
    const e = cal[k];
    if (!e?.calificado_at || !e.resultado) continue;
    const t = new Date(e.calificado_at).getTime();
    if (Number.isFinite(t) && now - t >= 0 && now - t <= ttlDays * 86_400_000) return { area: k, entry: e };
  }
  return null;
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
    // now-t >= 0 descarta timestamps futuros (dato corrupto/clock skew), no es un off-by-one.
    return Number.isFinite(t) && now - t >= 0 && now - t <= ttlDays * 86_400_000;
  });
}

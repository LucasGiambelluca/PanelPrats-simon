// ─── ZoneResolver (Capacidad 3) ───────────────────────────────────────────────
// Geo-routing gazetteer-first: dado el texto del usuario, sugiere la oficina más
// cercana del AMBA de forma DETERMINÍSTICA (sin geocoding online, sin alucinar).
// La videollamada es siempre el fallback universal.
//
//  - Match en gazetteer → oficina + confianza 'alta'.
//  - Fuera de cobertura (interior, otra provincia, La Plata) → video directo.
//  - Demasiado vago ("provincia", "conurbano") → UNA pregunta de aclaración.
//  - Sin señal de localidad → pedir la zona.
//
// El gazetteer es DATO EDITABLE (tabla zone_gazetteer): la lista de acá es el seed
// por defecto, embebido para funcionar offline y en tests.

import { norm } from './normalize';
import { supabase } from '../../../config/supabase';

export type Oficina = 'CABA' | 'Quilmes' | 'Haedo';

export interface GazetteerEntry { alias_norm: string; oficina: Oficina; }

export interface ZoneResult {
  oficina_sugerida: Oficina | null;
  confianza: 'alta' | 'media' | 'baja';
  necesita_aclaracion: boolean;
  pregunta_aclaracion?: string;
  siempre_ofrecer_video: true;
}

const PREGUNTA =
  '¿De qué zona sos, más o menos? Sur (Quilmes, Lanús, Avellaneda), Oeste (Morón, Haedo, Ramos Mejía), Capital, o decime tu localidad.';

// Localidades del AMBA → oficina más cercana. Editable vía tabla zone_gazetteer.
const RAW: Record<Oficina, string[]> = {
  Quilmes: [
    'quilmes', 'bernal', 'don bosco', 'ezpeleta', 'berazategui', 'florencio varela', 'varela',
    'avellaneda', 'lanus', 'lomas de zamora', 'lomas', 'banfield', 'temperley', 'adrogue',
    'almirante brown', 'alte brown', 'wilde', 'sarandi', 'gerli', 'remedios de escalada',
    'monte grande', 'burzaco', 'longchamps', 'rafael calzada', 'claypole', 'solano',
  ],
  Haedo: [
    'haedo', 'moron', 'castelar', 'ituzaingo', 'ramos mejia', 'ramos', 'san justo', 'la matanza',
    'ciudadela', 'hurlingham', 'merlo', 'moreno', 'el palomar', 'villa sarmiento', 'liniers',
    'ramos mejía', 'gonzalez catan', 'gregorio de laferrere', 'laferrere', 'isidro casanova',
    'william morris', 'caseros', 'tres de febrero', 'san antonio de padua', 'padua', 'libertad',
  ],
  CABA: [
    'caba', 'capital', 'capital federal', 'ciudad', 'microcentro', 'caballito', 'flores', 'floresta',
    'belgrano', 'palermo', 'once', 'balvanera', 'almagro', 'villa crespo', 'villa urquiza',
    'devoto', 'villa devoto', 'mataderos', 'pompeya', 'boedo', 'san telmo', 'la boca', 'barracas',
    'recoleta', 'retiro', 'constitucion', 'congreso', 'parque patricios', 'chacarita', 'colegiales',
    'nunez', 'saavedra', 'villa del parque', 'paternal', 'villa lugano', 'villa soldati', 'pompeya',
    // Zona norte → CABA
    'vicente lopez', 'olivos', 'san isidro', 'martinez', 'tigre', 'san fernando', 'beccar',
    'florida', 'munro', 'la lucila', 'acassuso', 'boulogne', 'villa adelina',
  ],
};

// Fuera de cobertura presencial → videollamada directa (no preguntar zona).
const OUT_OF_COVERAGE = [
  'la plata', 'berisso', 'ensenada', 'cordoba', 'rosario', 'santa fe', 'mendoza', 'mar del plata',
  'neuquen', 'tucuman', 'salta', 'chaco', 'corrientes', 'misiones', 'entre rios', 'san juan',
  'san luis', 'jujuy', 'formosa', 'la pampa', 'rio negro', 'chubut', 'santa cruz', 'bahia blanca',
  'tandil', 'pinamar', 'interior', 'otra provincia', 'del exterior', 'exterior',
];

// Vago: menciona zona amplia pero ninguna localidad concreta → pedir aclaración.
const VAGUE = ['provincia', 'conurbano', 'gba', 'gran buenos aires', 'zona sur', 'zona oeste', 'zona norte', 'afuera', 'las afueras'];

export const DEFAULT_GAZETTEER: GazetteerEntry[] = Object.entries(RAW).flatMap(
  ([oficina, aliases]) => aliases.map((a) => ({ alias_norm: norm(a), oficina: oficina as Oficina })),
);

/**
 * Traduce la ZONA lógica del geo-router (CABA/Quilmes/Haedo) al NOMBRE REAL de la
 * agenda presencial en la base. Las agendas se nombran por profesional ("SERENA
 * QUILMES", "DAIANA CABA", "MAURA HAEDO"), así que el literal de zona NO coincide con
 * ningún `account_offices.nombre` → `getOffice` devuelve null → `freeSlots` vacío →
 * el presencial cae SIEMPRE a videollamada. Este puente lo evita.
 *
 * Match por TOKEN (no substring) contra agendas que aceptan presencial (modalidad
 * 'presencial' | 'ambas'). Devuelve el nombre real, o null si no hay agenda
 * presencial para esa zona (ahí el flujo ofrece videollamada, con aviso).
 */
export function resolveOfficeName(
  zoneKey: string,
  offices: Array<{ nombre: string; modalidad: string }>,
): string | null {
  const key = norm(zoneKey);
  if (!key) return null;
  const presenciales = offices.filter((o) => o.modalidad !== 'video');
  // 1) Coincidencia exacta de nombre (por si alguna agenda se llama igual que la zona).
  const exact = presenciales.find((o) => norm(o.nombre) === key);
  if (exact) return exact.nombre;
  // 2) Agenda presencial cuyo nombre CONTIENE la zona como token entero.
  const hit = presenciales.find((o) => norm(o.nombre).split(' ').includes(key));
  return hit?.nombre ?? null;
}

function includesPhrase(haystack: string, needle: string): boolean {
  // match por límite de palabra para no pegar "lanus" dentro de otra cosa.
  return new RegExp(`(^|\\s)${needle.replace(/\s+/g, '\\s+')}(\\s|$)`).test(haystack);
}

/** Matcher determinístico puro. La carga de la tabla + fallback IA viven aparte. */
export function matchZone(texto: string, gazetteer: GazetteerEntry[]): ZoneResult {
  const t = norm(texto);
  const base = { siempre_ofrecer_video: true as const };

  if (!t) return { ...base, oficina_sugerida: null, confianza: 'baja', necesita_aclaracion: true, pregunta_aclaracion: PREGUNTA };

  // 1) Fuera de cobertura → video directo (chequear ANTES del gazetteer).
  if (OUT_OF_COVERAGE.some((c) => includesPhrase(t, c))) {
    return { ...base, oficina_sugerida: null, confianza: 'alta', necesita_aclaracion: false };
  }

  // 2) Gazetteer determinístico: gana el alias más largo que matchee (más específico).
  const hits = gazetteer
    .filter((g) => g.alias_norm && includesPhrase(t, g.alias_norm))
    .sort((a, b) => b.alias_norm.length - a.alias_norm.length);
  if (hits.length) {
    return { ...base, oficina_sugerida: hits[0].oficina, confianza: 'alta', necesita_aclaracion: false };
  }

  // 3) Vago → una pregunta de aclaración.
  if (VAGUE.some((v) => includesPhrase(t, v))) {
    return { ...base, oficina_sugerida: null, confianza: 'baja', necesita_aclaracion: true, pregunta_aclaracion: PREGUNTA };
  }

  // 4) Sin señal → pedir la zona (el caller puede además intentar IA como fallback).
  return { ...base, oficina_sugerida: null, confianza: 'baja', necesita_aclaracion: true, pregunta_aclaracion: PREGUNTA };
}

/**
 * Resolver listo para producción: carga las localidades extra de la cuenta
 * (zone_gazetteer) y las suma al gazetteer por defecto. Degrada al default si la
 * tabla no existe / falla.
 */
export class ZoneResolver {
  async suggest(accountId: string, texto: string): Promise<ZoneResult> {
    let extra: GazetteerEntry[] = [];
    try {
      const { data } = await supabase
        .from('zone_gazetteer')
        .select('alias_norm, oficina')
        .eq('account_id', accountId);
      extra = ((data ?? []) as any[])
        .filter((r) => r.alias_norm && r.oficina)
        .map((r) => ({ alias_norm: norm(r.alias_norm), oficina: r.oficina as Oficina }));
    } catch { extra = []; }
    return matchZone(texto, [...extra, ...DEFAULT_GAZETTEER]);
  }
}

export interface TelefonoARResult {
  valido: boolean;
  normalizado: string | null;   // '54' + 10 dígitos, o null si inválido
  motivo?: 'area_desconocida' | 'largo_invalido' | 'vacio';
}

// Códigos de área AR (set curado, ampliable). 2 díg = CABA/GBA; 3 y 4 díg = resto.
export const AREA_CODES_AR: ReadonlySet<string> = new Set<string>([
  // 2 dígitos
  '11',
  // 3 dígitos (principales)
  '220', '221', '223', '230', '236', '237', '249', '261', '263', '264', '266', '280', '291', '297', '299',
  '336', '341', '342', '343', '345', '348', '351', '353', '358', '362', '364', '370', '376', '379',
  '381', '383', '385', '387', '388',
  // 4 dígitos (Buenos Aires y otras)
  '2202', '2221', '2223', '2224', '2225', '2226', '2227', '2229', '2241', '2242', '2243', '2244', '2245',
  '2246', '2252', '2254', '2255', '2257', '2261', '2262', '2264', '2265', '2266', '2267', '2271', '2272',
  '2273', '2274', '2281', '2283', '2284', '2285', '2286', '2291', '2292', '2296', '2297',
  '2314', '2316', '2317', '2320', '2323', '2324', '2325', '2326', '2331', '2333', '2335', '2336', '2337',
  '2338', '2342', '2343', '2344', '2345', '2346', '2352', '2353', '2354', '2355', '2356', '2357', '2358',
  '2361', '2362', '2363', '2364', '2365', '2392', '2393', '2394', '2395', '2396',
]);

/** Deja solo el "número nacional significativo": sin +54, sin 0, sin 9, sin 15. */
function nacionalSignificativo(digits: string): string {
  let d = digits;
  if (d.startsWith('54')) d = d.slice(2);   // país
  if (d.startsWith('0')) d = d.slice(1);    // 0 nacional
  // Ningún código de área AR empieza con 9 → sacar el 9 inicial nunca corrompe un área válida.
  if (d.startsWith('9')) d = d.slice(1);    // 9 móvil
  // 15 móvil viejo: aparece DESPUÉS del área. Lo resolvemos al separar área (abajo).
  return d;
}

/** Valida un teléfono AR por conformación (código de área real + largo). Pura. */
export function validarTelefonoAR(texto: string): TelefonoARResult {
  const digits = (texto || '').replace(/\D/g, '');
  if (!digits) return { valido: false, normalizado: null, motivo: 'vacio' };

  let d = nacionalSignificativo(digits);

  // Probar el código de área más largo primero (4 → 3 → 2).
  for (const len of [4, 3, 2]) {
    const area = d.slice(0, len);
    if (!AREA_CODES_AR.has(area)) continue;
    const resto = d.slice(len);
    let total = area + resto;
    // El "15" de móvil viejo va DESPUÉS del área. Solo lo sacamos si así queda un
    // nacional de 10 dígitos (no si el abonado real empieza con 15).
    if (total.length !== 10 && resto.startsWith('15') && (area + resto.slice(2)).length === 10) {
      total = area + resto.slice(2);
    }
    if (total.length === 10) return { valido: true, normalizado: '54' + total };
  }

  // Si llegó acá: o el largo no cierra, o ningún área matchea.
  if (d.replace(/^15/, '').length < 8 || d.length > 12) {
    return { valido: false, normalizado: null, motivo: 'largo_invalido' };
  }
  return { valido: false, normalizado: null, motivo: 'area_desconocida' };
}

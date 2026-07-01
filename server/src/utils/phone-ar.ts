export interface TelefonoARResult {
  valido: boolean;
  normalizado: string | null;   // '54' + 10 dígitos, o null si inválido
  motivo?: 'area_desconocida' | 'largo_invalido' | 'vacio';
}

/**
 * Valida un teléfono AR por FORMA, no contra una lista blanca de áreas.
 *
 * El número nacional significativo de Argentina es de 10 dígitos (código de área de
 * 2 a 4 dígitos + abonado) y todos los códigos de área arrancan con 1, 2 o 3. Antes se
 * validaba contra un set curado de áreas (`AREA_CODES_AR`), incompleto: rechazaba
 * números reales de localidades del interior (Gualeguaychú 3446, Punta Alta 2932,
 * Eldorado 3757, etc.) y mataba el agendado en el último paso. Ahora se valida por largo
 * + primer dígito, que cubre TODO el país sin mantener una lista.
 *
 * Tolera prefijos +54 (país), 0 (nacional), 9 (móvil) y 15 (móvil viejo, va después del
 * área). Pura.
 */
export function validarTelefonoAR(texto: string): TelefonoARResult {
  const digits = (texto || '').replace(/\D/g, '');
  if (!digits) return { valido: false, normalizado: null, motivo: 'vacio' };

  let d = digits;
  if (d.startsWith('54')) d = d.slice(2);   // país
  if (d.startsWith('0')) d = d.slice(1);    // 0 nacional
  // Ningún código de área AR empieza con 9 → sacar el 9 inicial nunca corrompe un área.
  if (d.startsWith('9')) d = d.slice(1);    // 9 móvil

  // '15' móvil viejo: va JUSTO DESPUÉS del área (2-4 díg). Si el número quedó en 12
  // dígitos, sacar el '15' que sigue al área para recuperar el nacional de 10.
  if (d.length === 12) {
    for (const areaLen of [2, 3, 4]) {
      if (d.slice(areaLen, areaLen + 2) === '15') {
        const cand = d.slice(0, areaLen) + d.slice(areaLen + 2);
        if (cand.length === 10) { d = cand; break; }
      }
    }
  }

  if (d.length !== 10) return { valido: false, normalizado: null, motivo: 'largo_invalido' };
  // Todos los códigos de área AR arrancan con 1, 2 o 3.
  if (!/^[123]/.test(d)) return { valido: false, normalizado: null, motivo: 'area_desconocida' };
  return { valido: true, normalizado: '54' + d };
}

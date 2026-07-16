/**
 * ¿El valor parece un PSID/IGSID de FB/Instagram (todo dígitos y largo)?
 * Un identificador de red social nunca es un nombre de persona ni un teléfono
 * llamable. Umbral 11+ dígitos: los PSID reales tienen 15-17; un nombre jamás
 * es una tira de 11 dígitos. Pura.
 */
export function esPsid(v: string | null | undefined): boolean {
  return /^\d{11,}$/.test((v ?? '').trim());
}

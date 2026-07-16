/**
 * ¿El valor parece un PSID/IGSID de FB/Instagram (todo dígitos y largo)?
 * Un id de red social nunca es un nombre ni un teléfono llamable.
 * Espejo del util del server (server/src/utils/psid.ts).
 */
export function esPsid(v: string | null | undefined): boolean {
  return /^\d{11,}$/.test((v ?? '').trim());
}

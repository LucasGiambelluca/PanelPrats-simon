// Feriados nacionales de Argentina (inamovibles + trasladables ya resueltos) 2026-2027.
// Fechas en formato YYYY-MM-DD en horario local AR. Editable: agregar años nuevos acá.
// No incluye feriados provinciales ni "días no laborables" opcionales.
const HOLIDAYS_AR = new Set<string>([
  // 2026
  '2026-01-01', // Año Nuevo
  '2026-02-16', // Carnaval
  '2026-02-17', // Carnaval
  '2026-03-24', // Día de la Memoria
  '2026-04-02', // Malvinas
  '2026-04-03', // Viernes Santo
  '2026-05-01', // Día del Trabajador
  '2026-05-25', // Revolución de Mayo
  '2026-06-15', // Güemes (trasladado)
  '2026-06-20', // Belgrano
  '2026-07-09', // Independencia
  '2026-08-17', // San Martín
  '2026-10-12', // Diversidad Cultural
  '2026-11-23', // Soberanía (trasladado)
  '2026-12-08', // Inmaculada Concepción
  '2026-12-25', // Navidad
  // 2027
  '2027-01-01', '2027-02-08', '2027-02-09', '2027-03-24', '2027-04-02',
  '2027-03-26', '2027-05-01', '2027-05-25', '2027-06-21', '2027-06-20',
  '2027-07-09', '2027-08-16', '2027-10-11', '2027-11-22', '2027-12-08', '2027-12-25',
]);

/** ¿Es feriado nacional AR? `ymd` en formato 'YYYY-MM-DD' (fecha local AR). */
export function isHolidayAR(ymd: string): boolean {
  return HOLIDAYS_AR.has(ymd);
}

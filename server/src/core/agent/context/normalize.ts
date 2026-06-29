// Normalización compartida por los servicios de contexto del agente.
// Política: minúsculas + sin diacríticos. ñ→n es aceptable: se aplica igual a la
// query y a las etiquetas, así el matching queda consistente en ambos lados.

/** Minúsculas y sin acentos/diacríticos. */
export function stripAccents(s: string): string {
  return (s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/** Normaliza para comparar: sin acentos, solo alfanumérico+espacios, colapsado, trim. */
export function norm(s: string): string {
  return stripAccents(s)
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Tokens significativos (>=minLen) para matching por solapamiento. */
export function tokens(s: string, minLen = 4): string[] {
  return norm(s).split(' ').filter((w) => w.length >= minLen);
}

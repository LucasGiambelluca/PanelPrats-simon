// Interpolación segura de {{var}}: si la variable falta, queda vacío y se colapsa
// el espacio sobrante (evita "¡Hola undefined!" y "¡Hola  !").
export function interpolate(template: string, ctx: Record<string, any>): string {
  const out = String(template || '').replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, name) => {
    const v = ctx[name];
    return v === undefined || v === null ? '' : String(v);
  });
  // colapsar doble espacio dejado por una var vacía, sin tocar saltos de línea
  return out.replace(/ {2,}/g, ' ').replace(/ +([!?.,])/g, '$1');
}

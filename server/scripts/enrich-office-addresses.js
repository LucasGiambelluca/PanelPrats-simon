// One-off: enriquece las direcciones de las agendas presenciales con las referencias
// del libreto (Edificio Apolo, "a dos cuadras del Obelisco", etc.). Esa dirección se
// muestra al confirmar la cita presencial. Solo toca la cuenta WhatsApp del estudio.
// Uso: node scripts/enrich-office-addresses.js
require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) { console.error('Falta SUPABASE_URL / SUPABASE_SERVICE_KEY'); process.exit(1); }
const supabase = createClient(url, key, { auth: { persistSession: false }, realtime: { transport: ws } });

// Match por token en el nombre de la agenda (case-insensitive) → dirección completa del libreto.
const DIRS = [
  { token: 'CABA',    direccion: 'Corrientes 1386, oficina 520, Edificio Apolo, a dos cuadras del Obelisco' },
  { token: 'QUILMES', direccion: 'Moreno 609, oficina 1G, casi esquina Rivadavia' },
  { token: 'HAEDO',   direccion: 'Héroes de Malvinas Argentinas 35, a dos cuadras de la estación' },
];

(async () => {
  // Solo agendas presenciales/ambas (las de video no tienen dirección).
  const { data: offices, error } = await supabase
    .from('account_offices')
    .select('id, nombre, modalidad, direccion')
    .neq('modalidad', 'video');
  if (error) { console.error('ERROR select:', error.message); process.exit(1); }

  let updated = 0;
  for (const o of offices || []) {
    const n = (o.nombre || '').toUpperCase();
    const match = DIRS.find((d) => n.split(/\s+/).includes(d.token));
    if (!match) { console.log(`(sin match) ${o.nombre}`); continue; }
    if (o.direccion === match.direccion) { console.log(`(ya ok)    ${o.nombre}`); continue; }
    const { error: e2 } = await supabase
      .from('account_offices')
      .update({ direccion: match.direccion, updated_at: new Date().toISOString() })
      .eq('id', o.id);
    if (e2) { console.error(`ERROR update ${o.nombre}:`, e2.message); continue; }
    console.log(`ACTUALIZADA ${o.nombre}\n   antes: ${o.direccion}\n   ahora: ${match.direccion}`);
    updated++;
  }
  console.log(`\nlisto: ${updated} direcciones actualizadas`);
})();

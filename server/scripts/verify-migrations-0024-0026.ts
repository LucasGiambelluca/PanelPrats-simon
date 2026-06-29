// Verifica que las migraciones 0024-0026 estén aplicadas: selecciona las columnas
// nuevas (si no existen, supabase devuelve error) y prueba la tabla zone_gazetteer.
import 'dotenv/config';
import { supabase } from '../src/config/supabase';

async function checkCols(table: string, cols: string[]): Promise<void> {
  const { error } = await supabase.from(table).select(cols.join(', ')).limit(1);
  if (error) console.log(`❌ ${table} [${cols.join(', ')}] → ${error.message}`);
  else console.log(`✅ ${table}: columnas OK (${cols.join(', ')})`);
}

(async () => {
  // 0024
  await checkCols('contact_memory', ['last_topic', 'last_interaction_at', 'current_thread']);
  // 0025
  await checkCols('appointments', ['resumen_ia', 'perfil_json']);
  // 0026
  await checkCols('account_offices', ['lat', 'lng']);
  const { error: gz } = await supabase.from('zone_gazetteer').select('id, account_id, alias, alias_norm, oficina').limit(1);
  if (gz) console.log(`❌ zone_gazetteer → ${gz.message}`);
  else console.log('✅ zone_gazetteer: tabla OK');
  process.exit(0);
})();

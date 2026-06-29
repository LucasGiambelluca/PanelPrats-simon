import 'dotenv/config';
import { supabase } from '../src/config/supabase';
import { DEFAULT_GAZETTEER } from '../src/core/agent/context/ZoneResolver';

// Carga el gazetteer por defecto (AMBA) en la tabla zone_gazetteer para una cuenta.
// El ZoneResolver ya funciona sin esto (usa DEFAULT_GAZETTEER embebido); sembrar la
// tabla solo es necesario si querés AGREGAR localidades propias sin redeploy.

const ACC = process.env.SMOKE_ACCOUNT_ID || 'fbf99cec-ddc9-4ef2-94d0-8f14d0bcb982';

(async () => {
  const rows = DEFAULT_GAZETTEER.map((g) => ({
    account_id: ACC, alias: g.alias_norm, alias_norm: g.alias_norm, oficina: g.oficina,
  }));
  // upsert por (account_id, alias_norm): idempotente, no duplica.
  const { data, error } = await supabase
    .from('zone_gazetteer')
    .upsert(rows, { onConflict: 'account_id,alias_norm' })
    .select('id');
  if (error) { console.log('UPSERT error:', error.message); process.exit(1); }
  console.log(`✅ ${data?.length ?? rows.length} localidades cargadas en zone_gazetteer para ${ACC}`);
  process.exit(0);
})();

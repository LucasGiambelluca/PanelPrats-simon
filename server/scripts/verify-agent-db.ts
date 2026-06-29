import 'dotenv/config';
import { supabase } from '../src/config/supabase';

(async () => {
  const { data: faqs, error: e1 } = await supabase.from('account_faqs').select('account_id, pregunta');
  if (e1) console.log('account_faqs ERROR:', e1.message);
  else {
    console.log('account_faqs total:', faqs?.length ?? 0);
    const byAcc: Record<string, number> = {};
    for (const f of faqs ?? []) byAcc[f.account_id] = (byAcc[f.account_id] ?? 0) + 1;
    console.log('por cuenta:', JSON.stringify(byAcc, null, 2));
  }

  const { data: accs, error: e2 } = await supabase.from('accounts').select('id, name, phone_number, agent_mode, channel');
  if (e2) console.log('accounts ERROR:', e2.message);
  else console.log('cuentas:', JSON.stringify(accs, null, 2));
  process.exit(0);
})();

import path from 'path';
import dotenv from 'dotenv';
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import ws from 'ws';

const hasRealCreds = !!(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

if (!hasRealCreds) {
  console.warn('⚠️ [supabase] Falta SUPABASE_URL o SUPABASE_SERVICE_KEY en .env — usando placeholders (sin acceso real a la DB)');
}

// Fallbacks no-vacíos: @supabase/supabase-js lanza si la URL/clave están vacías.
// En runtime real estos vienen del .env; los placeholders solo permiten construir el cliente.
const supabaseUrl = process.env.SUPABASE_URL || 'http://localhost:54321';
const supabaseKey = process.env.SUPABASE_SERVICE_KEY || 'placeholder-service-key';

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseKey, {
  auth: { persistSession: false, autoRefreshToken: true },
  // Node < 22 no trae WebSocket global; supabase-realtime necesita el transport explícito.
  realtime: { timeout: 60000, params: { events_per_second: 20 }, transport: ws as any },
  db: { schema: 'public' },
});

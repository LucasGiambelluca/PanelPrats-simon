import 'dotenv/config';
import fs from 'fs';
import path from 'path';

const STORE_FILE = path.resolve(process.cwd(), 'memory_store.json');

// El store en memoria es SOLO un fallback para cuando no hay Supabase configurado.
// Si Supabase está configurado, Supabase es la única fuente de verdad: arrancamos
// vacíos y no persistimos en disco, para no reintroducir el split-brain
// (cuentas/flows que viven en memoria "ganándole" a Supabase via memoryAccounts.has()).
const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_KEY &&
  !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
  !process.env.SUPABASE_SERVICE_KEY.includes('...')
);

interface StoreData {
  accounts: [string, any][];
  flows: [string, any][];
}

function loadStore(): StoreData {
  try {
    if (fs.existsSync(STORE_FILE)) {
      const content = fs.readFileSync(STORE_FILE, 'utf-8');
      const parsed = JSON.parse(content);
      return {
        accounts: Array.isArray(parsed.accounts) ? parsed.accounts : [],
        flows: Array.isArray(parsed.flows) ? parsed.flows : []
      };
    }
  } catch (err) {
    console.error('[MemoryStore] Error loading persistent memory store:', err);
  }
  return { accounts: [], flows: [] };
}

const initialData = isSupabaseConfigured ? { accounts: [], flows: [] } : loadStore();

class PersistentMap<K, V> extends Map<K, V> {
  constructor(entries?: readonly (readonly [K, V])[] | null, private onUpdate?: () => void) {
    super(entries);
  }

  set(key: K, value: V): this {
    super.set(key, value);
    if (this.onUpdate) this.onUpdate();
    return this;
  }

  delete(key: K): boolean {
    const res = super.delete(key);
    if (res && this.onUpdate) this.onUpdate();
    return res;
  }

  clear(): void {
    super.clear();
    if (this.onUpdate) this.onUpdate();
  }
}

function saveStore() {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  // Con Supabase configurado no persistimos memoria en disco (Supabase es la verdad).
  if (isSupabaseConfigured) {
    return;
  }
  try {
    const data: StoreData = {
      accounts: Array.from(memoryAccounts.entries()),
      flows: Array.from(memoryFlows.entries())
    };
    fs.writeFileSync(STORE_FILE, JSON.stringify(data, null, 2), 'utf-8');
  } catch (err) {
    console.error('[MemoryStore] Error saving persistent memory store:', err);
  }
}

export const memoryAccounts = new PersistentMap<string, any>(initialData.accounts, saveStore);
export const memoryFlows = new PersistentMap<string, any>(initialData.flows, saveStore);

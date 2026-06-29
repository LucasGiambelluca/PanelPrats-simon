// Aplica un archivo de migración SQL a la DB de DATABASE_URL. Uso:
//   node -r dotenv/config scripts/apply-migration.js ../supabase/migrations/0015_agent_runtime.sql
const fs = require('fs');
const path = require('path');
const { Client } = require('pg');

(async () => {
  const rel = process.argv[2];
  if (!rel) { console.error('Falta el path del .sql'); process.exit(1); }
  const file = path.resolve(process.cwd(), rel);
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('Falta DATABASE_URL en el entorno'); process.exit(1); }

  const sql = fs.readFileSync(file, 'utf8');
  const client = new Client({
    connectionString: dbUrl,
    ssl: dbUrl.includes('supabase') || dbUrl.includes('localhost') ? { rejectUnauthorized: false } : false,
  });
  try {
    await client.connect();
    console.log(`Aplicando ${path.basename(file)}…`);
    await client.query(sql);
    console.log('✅ OK');
  } catch (e) {
    console.error('❌ Error:', e.message);
    process.exit(1);
  } finally {
    await client.end().catch(() => {});
  }
})();

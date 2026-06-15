import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { spawn } from 'child_process';

// Path to .env file
const envPath = path.join(process.cwd(), '.env');
const migrationPath = path.join(process.cwd(), '../supabase/migrations/0001_init_multicuenta.sql');

// Helper to parse .env file
function readEnv(): Record<string, string> {
  const result: Record<string, string> = {};
  if (!fs.existsSync(envPath)) return result;

  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    const parts = trimmed.split('=');
    const key = parts[0].trim();
    let val = parts.slice(1).join('=').trim();

    // Remove surrounding quotes if present
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

// Helper to write .env file
function writeEnv(configs: Record<string, string>) {
  let content = '';

  // Preserve some comments and structure, or write fresh formatted keys
  content += '# ---- Supabase ----\n';
  content += `SUPABASE_URL=${configs.SUPABASE_URL || ''}\n`;
  content += `SUPABASE_SERVICE_KEY=${configs.SUPABASE_SERVICE_KEY || ''}\n`;
  content += `DATABASE_URL=${configs.DATABASE_URL || ''}\n\n`;

  content += '# ---- Redis ----\n';
  content += `REDIS_URL=${configs.REDIS_URL || 'redis://127.0.0.1:6379'}\n\n`;

  content += '# ---- Baileys ----\n';
  content += `AUTH_BASE_PATH=${configs.AUTH_BASE_PATH || './auth'}\n\n`;

  content += '# ---- IA ----\n';
  content += `GROQ_API_KEY=${configs.GROQ_API_KEY || ''}\n`;
  content += `GEMINI_API_KEY=${configs.GEMINI_API_KEY || ''}\n\n`;

  content += '# ---- Server ----\n';
  content += `PORT=${configs.PORT || '3001'}\n`;
  content += `CORS_ORIGIN=${configs.CORS_ORIGIN || 'http://localhost:5173'}\n`;

  fs.writeFileSync(envPath, content, 'utf8');
}

export function configRouter(): Router {
  const r = Router();

  // Get current configurations
  r.get('/', (req, res) => {
    const envData = readEnv();
    res.json(envData);
  });

  // Save configurations
  r.post('/', (req, res) => {
    try {
      const current = readEnv();
      const updated = { ...current, ...req.body };
      writeEnv(updated);
      res.json({ success: true, message: 'Configuraciones guardadas' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Sincronizar base de datos (Ejecuta DDL migrations)
  r.post('/sync-db', async (req, res) => {
    const envData = readEnv();
    const dbUrl = req.body.DATABASE_URL || envData.DATABASE_URL;

    if (!dbUrl) {
      return res.status(400).json({ error: 'Falta configurar la variable DATABASE_URL' });
    }

    if (!fs.existsSync(migrationPath)) {
      return res.status(404).json({ error: `No se encontró el archivo de migración en ${migrationPath}` });
    }

    const client = new Client({
      connectionString: dbUrl,
      // Allow self-signed certificates (common in Supabase and hosted PG instances)
      ssl: dbUrl.includes('supabase') || dbUrl.includes('localhost') ? { rejectUnauthorized: false } : false,
    });

    try {
      await client.connect();
      const sqlContent = fs.readFileSync(migrationPath, 'utf8');
      
      console.log('🔄 [sync-db] Running migrations...');
      await client.query(sqlContent);
      console.log('✅ [sync-db] Migrations completed successfully');

      res.json({ success: true, message: 'Tablas sincronizadas y creadas con éxito.' });
    } catch (err: any) {
      console.error('❌ [sync-db] Error:', err);
      res.status(500).json({ error: err.message });
    } finally {
      await client.end().catch(() => {});
    }
  });

  // Relanzar/Reiniciar aplicación
  r.post('/restart', (req, res) => {
    res.json({ success: true, message: 'Reiniciando el backend en 1 segundo...' });

    console.log('🔄 [server] Restarting process...');

    // Clean current process.env variables that were loaded by dotenv
    const keysToClean = [
      'SUPABASE_URL',
      'SUPABASE_SERVICE_KEY',
      'DATABASE_URL',
      'REDIS_URL',
      'AUTH_BASE_PATH',
      'GROQ_API_KEY',
      'GEMINI_API_KEY',
      'PORT',
      'CORS_ORIGIN'
    ];

    keysToClean.forEach(k => {
      delete process.env[k];
    });

    setTimeout(() => {
      // Spawn new detached child process of the same command
      const child = spawn(process.argv[0], process.argv.slice(1), {
        detached: true,
        stdio: 'inherit',
        cwd: process.cwd()
      });
      child.unref();
      // Exit parent
      process.exit(0);
    }, 1000);
  });

  return r;
}

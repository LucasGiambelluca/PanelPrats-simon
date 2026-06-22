import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import { spawn } from 'child_process';

// Path to .env file
const envPath = path.join(process.cwd(), '.env');
const migrationsDir = path.join(process.cwd(), '../supabase/migrations');

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

const SENSITIVE_KEY = /KEY|SECRET|TOKEN|PASSWORD|SERVICE|DATABASE_URL/i;
const MASK_PREFIX = '••••';

function maskValue(k: string, v: string): string {
  if (!v || !SENSITIVE_KEY.test(k)) return v;
  return MASK_PREFIX + String(v).slice(-4);
}

// Merge: parte del .env ACTUAL (preserva TODAS las claves: DAILY, OPENAI, ai_*, etc.)
// y solo sobreescribe las provistas. Ignora valores enmascarados (no se editaron).
function writeEnv(updates: Record<string, string>) {
  const current = readEnv();
  const merged: Record<string, string> = { ...current };
  for (const [k, v] of Object.entries(updates)) {
    if (typeof v === 'string' && v.startsWith(MASK_PREFIX)) continue; // sin cambios
    merged[k] = v ?? '';
  }
  const content = Object.entries(merged).map(([k, v]) => `${k}=${v ?? ''}`).join('\n') + '\n';
  fs.writeFileSync(envPath, content, 'utf8');
}

export function configRouter(): Router {
  const r = Router();

  // Get current configurations (secretos enmascarados: ••••<últimos 4>)
  r.get('/', (req, res) => {
    const envData = readEnv();
    const masked: Record<string, string> = {};
    for (const [k, v] of Object.entries(envData)) masked[k] = maskValue(k, v);
    res.json(masked);
  });

  // Claves que NUNCA se pueden editar desde la UI: reabrirían el bypass de auth
  // o cambiarían el modo de ejecución en producción.
  const FORBIDDEN_KEYS = ['DEV_AUTH_BYPASS', 'NODE_ENV'];

  // Save configurations
  r.post('/', (req, res) => {
    try {
      const body = req.body || {};
      const bad = Object.keys(body).filter((k) => FORBIDDEN_KEYS.includes(k));
      if (bad.length) {
        return res.status(400).json({ error: `Claves no editables por seguridad: ${bad.join(', ')}` });
      }
      const current = readEnv();
      const updated = { ...current, ...body };
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

    if (!fs.existsSync(migrationsDir)) {
      return res.status(404).json({ error: `No se encontró el directorio de migraciones en ${migrationsDir}` });
    }

    // Todas las migraciones en orden lexicográfico (0001, 0002, …, 0014). Cada
    // archivo es idempotente (IF NOT EXISTS / DO $$ guards), así que re-correr es seguro.
    const files = fs.readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    if (files.length === 0) {
      return res.status(404).json({ error: `No hay archivos .sql en ${migrationsDir}` });
    }

    const client = new Client({
      connectionString: dbUrl,
      // Allow self-signed certificates (common in Supabase and hosted PG instances)
      ssl: dbUrl.includes('supabase') || dbUrl.includes('localhost') ? { rejectUnauthorized: false } : false,
    });

    const applied: string[] = [];
    try {
      await client.connect();
      console.log(`🔄 [sync-db] Aplicando ${files.length} migraciones…`);
      for (const file of files) {
        const sqlContent = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        await client.query(sqlContent);
        applied.push(file);
        console.log(`  ✓ ${file}`);
      }
      console.log('✅ [sync-db] Migraciones completadas');
      res.json({ success: true, applied, message: `${applied.length} migraciones aplicadas.` });
    } catch (err: any) {
      const failed = files[applied.length];
      console.error(`❌ [sync-db] Error en ${failed}:`, err);
      res.status(500).json({ error: err.message, failedMigration: failed, applied });
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

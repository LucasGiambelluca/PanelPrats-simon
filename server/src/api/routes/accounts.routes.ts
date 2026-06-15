import { Router } from 'express';
import { supabase } from '../../config/supabase';
import type { AccountManager } from '../../core/accounts/AccountManager';
import crypto from 'crypto';

// In-memory store as fallback when Supabase is not configured
const memoryAccounts: Map<string, any> = new Map();

const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_KEY &&
  !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
  !process.env.SUPABASE_SERVICE_KEY.includes('...')
);

export function accountsRouter(manager: AccountManager): Router {
  const r = Router();

  // Crear cuenta
  r.post('/', async (req, res) => {
    const { user_id, name, phone_number } = req.body;

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('accounts')
        .insert({ user_id, name, phone_number, status: 'disconnected' })
        .select('*')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    }

    // Fallback: in-memory
    const id = crypto.randomUUID();
    const account = {
      id, user_id, name,
      phone_number: phone_number || null,
      status: 'disconnected',
      qr_code: null,
      created_at: new Date().toISOString(),
    };
    memoryAccounts.set(id, account);
    console.log(`📝 [memory] Account created: ${name} (${id})`);
    res.json(account);
  });

  // Listar cuentas de un usuario
  r.get('/', async (req, res) => {
    const userId = req.query.user_id as string;

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('accounts').select('*').eq('user_id', userId);
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    }

    // Fallback: return all memory accounts for this user (or all if no filter)
    const list = Array.from(memoryAccounts.values()).filter(
      a => !userId || a.user_id === userId
    );
    // Sync statuses from AccountManager
    for (const a of list) {
      const liveStatus = manager.getStatus(a.id);
      if (liveStatus !== 'disconnected') {
        a.status = liveStatus === 'SCAN_QR_CODE' ? 'qr'
                 : liveStatus === 'WORKING' ? 'connected'
                 : liveStatus === 'STOPPED' ? 'disconnected'
                 : a.status;
      }
    }
    res.json(list);
  });

  // Conectar (levanta Baileys → genera QR)
  r.post('/:id/connect', async (req, res) => {
    try {
      await manager.connect(req.params.id);
      const status = manager.getStatus(req.params.id);
      // Update memory account status
      const memAcc = memoryAccounts.get(req.params.id);
      if (memAcc) memAcc.status = status === 'SCAN_QR_CODE' ? 'qr' : status === 'WORKING' ? 'connected' : 'connecting';
      res.json({ status });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
  });

  // QR de la cuenta
  r.get('/:id/qr', (req, res) => {
    const qr = manager.getQr(req.params.id);
    const rawStatus = manager.getStatus(req.params.id);
    // Map internal status to API status
    const status = rawStatus === 'SCAN_QR_CODE' ? 'qr'
                 : rawStatus === 'WORKING' ? 'connected'
                 : rawStatus === 'STOPPED' ? 'disconnected'
                 : rawStatus;
    res.json({ qr, status });
  });

  // Estado
  r.get('/:id/status', (req, res) => {
    const rawStatus = manager.getStatus(req.params.id);
    const status = rawStatus === 'SCAN_QR_CODE' ? 'qr'
                 : rawStatus === 'WORKING' ? 'connected'
                 : rawStatus === 'STOPPED' ? 'disconnected'
                 : rawStatus;
    res.json({ status });
  });

  // Desconectar
  r.post('/:id/disconnect', async (req, res) => {
    await manager.disconnect(req.params.id);
    const memAcc = memoryAccounts.get(req.params.id);
    if (memAcc) memAcc.status = 'disconnected';
    res.json({ status: 'disconnected' });
  });

  return r;
}

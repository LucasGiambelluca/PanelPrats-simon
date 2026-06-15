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
    const { user_id, name, phone_number, channel, external_id, access_token, app_secret, verify_token } = req.body;
    const resolvedChannel = channel || 'whatsapp';

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('accounts')
        .insert({
          user_id, name, phone_number, status: 'disconnected',
          channel: resolvedChannel,
          external_id: external_id || null,
          access_token: access_token || null,
          app_secret: app_secret || null,
          verify_token: verify_token || null,
        })
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
      channel: resolvedChannel,
      external_id: external_id || null,
      access_token: access_token || null,
      app_secret: app_secret || null,
      verify_token: verify_token || null,
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

  // Actualizar cuenta (por ejemplo: cambiar flujo, proveedor o credenciales)
  r.put('/:id', async (req, res) => {
    const { name, phone_number, channel, external_id, access_token, app_secret, verify_token, provider, flow_id } = req.body;
    const accountId = req.params.id;

    if (isSupabaseConfigured) {
      const { data, error } = await supabase
        .from('accounts')
        .update({
          name,
          phone_number,
          channel,
          external_id,
          access_token,
          app_secret,
          verify_token,
          provider,
          flow_id: flow_id || null
        })
        .eq('id', accountId)
        .select('*')
        .single();
      if (error) return res.status(400).json({ error: error.message });
      
      // Desconectar para que al reconectar tome la nueva configuración
      await manager.disconnect(accountId).catch(() => {});
      
      return res.json(data);
    }

    // Fallback: in-memory
    const memAcc = memoryAccounts.get(accountId);
    if (!memAcc) return res.status(404).json({ error: 'Cuenta no encontrada' });

    const updated = {
      ...memAcc,
      name: name !== undefined ? name : memAcc.name,
      phone_number: phone_number !== undefined ? phone_number : memAcc.phone_number,
      channel: channel !== undefined ? channel : memAcc.channel,
      external_id: external_id !== undefined ? external_id : memAcc.external_id,
      access_token: access_token !== undefined ? access_token : memAcc.access_token,
      app_secret: app_secret !== undefined ? app_secret : memAcc.app_secret,
      verify_token: verify_token !== undefined ? verify_token : memAcc.verify_token,
      provider: provider !== undefined ? provider : memAcc.provider,
      flow_id: flow_id !== undefined ? flow_id : memAcc.flow_id,
    };
    memoryAccounts.set(accountId, updated);
    
    await manager.disconnect(accountId).catch(() => {});

    res.json(updated);
  });

  return r;
}

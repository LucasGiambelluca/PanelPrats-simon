import { Router } from 'express';
import { z } from 'zod';
import { supabase } from '../../config/supabase';
import type { AccountManager } from '../../core/accounts/AccountManager';
import crypto from 'crypto';
import fs from 'fs';
import { authDir } from '../../lib/account-keys';

import { memoryAccounts, memoryFlows } from '../../core/accounts/memoryStore';
import { requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';

const createAccountSchema = z.object({
  name: z.string().trim().min(1),
  user_id: z.string().nullish(),
  phone_number: z.string().nullish(),
  channel: z.string().nullish(),
  external_id: z.string().nullish(),
  access_token: z.string().nullish(),
  app_secret: z.string().nullish(),
  verify_token: z.string().nullish(),
  provider: z.string().nullish(),
  flow_id: z.string().nullish(),
}).strict();

const updateAccountSchema = z.object({
  name: z.string().trim().min(1).optional(),
  phone_number: z.string().nullish(),
  channel: z.string().nullish(),
  external_id: z.string().nullish(),
  access_token: z.string().nullish(),
  app_secret: z.string().nullish(),
  verify_token: z.string().nullish(),
  provider: z.string().nullish(),
  flow_id: z.string().nullish(),
  reminder_minutes: z.coerce.number().int().positive().nullish(),
  ai_support_enabled: z.boolean().nullish(),
  ai_api_key: z.string().nullish(),
  ai_model: z.string().nullish(),
  ai_support_prompt: z.string().nullish(),
}).strict();

const AUTH_BASE_PATH = process.env.AUTH_BASE_PATH || './auth';

const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_KEY &&
  !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
  !process.env.SUPABASE_SERVICE_KEY.includes('...')
);

function isValidUUID(id: string): boolean {
  if (!id) return false;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(id);
}

// Campos sensibles que NO debe ver una empleada.
function slimAccount(a: any) {
  if (!a) return a;
  // qr_code se excluye: una empleada con el QR podría vincular/secuestrar la sesión de WhatsApp.
  const { access_token, app_secret, verify_token, ai_api_key, ai_support_prompt, qr_code, ...safe } = a;
  return safe;
}

export function accountsRouter(manager: AccountManager): Router {
  const r = Router();

  // Crear cuenta
  r.post('/', requireRole('admin'), validateBody(createAccountSchema), async (req, res) => {
    const { user_id, name, phone_number, channel, external_id, access_token, app_secret, verify_token, provider, flow_id } = req.body;
    const resolvedChannel = channel || 'whatsapp';
    const resolvedProvider = provider || 'baileys';

    const useSupabase = isSupabaseConfigured && isValidUUID(user_id);

    if (useSupabase) {
      const { data, error } = await supabase
        .from('accounts')
        .insert({
          user_id, name, phone_number, status: 'disconnected',
          channel: resolvedChannel,
          provider: resolvedProvider,
          flow_id: flow_id || null,
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
      provider: resolvedProvider,
      flow_id: flow_id || null,
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
    // Single-org: todas las líneas son del estudio. Admin y empleada ven TODAS
    // (admin con todos los campos; empleada sin secretos). No se filtra por user_id:
    // las cuentas pueden pertenecer a distintos admins/seed y aun así son compartidas.
    const role = req.user?.role;

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('accounts').select('*');
      if (error) return res.status(400).json({ error: error.message });
      return res.json(role === 'empleada' ? (data ?? []).map(slimAccount) : data);
    }

    // Fallback en memoria: todas las cuentas.
    const list = Array.from(memoryAccounts.values());
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
    res.json(role === 'empleada' ? list.map(slimAccount) : list);
  });

  // Conectar (levanta Baileys → genera QR)
  r.post('/:id/connect', requireRole('admin'), async (req, res) => {
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

  // QR de la cuenta (solo admin: con el QR se podría vincular/secuestrar la línea)
  r.get('/:id/qr', requireRole('admin'), (req, res) => {
    const qr = manager.getQr(req.params.id);
    const rawStatus = manager.getStatus(req.params.id);
    // Map internal status to API status
    const status = rawStatus === 'SCAN_QR_CODE' ? 'qr'
                 : rawStatus === 'WORKING' ? 'connected'
                 : rawStatus === 'STOPPED' ? 'disconnected'
                 : rawStatus;
    res.json({ qr, status });
  });

  // Estado (solo admin)
  r.get('/:id/status', requireRole('admin'), (req, res) => {
    const rawStatus = manager.getStatus(req.params.id);
    const status = rawStatus === 'SCAN_QR_CODE' ? 'qr'
                 : rawStatus === 'WORKING' ? 'connected'
                 : rawStatus === 'STOPPED' ? 'disconnected'
                 : rawStatus;
    res.json({ status });
  });

  // Desconectar
  r.post('/:id/disconnect', requireRole('admin'), async (req, res) => {
    await manager.disconnect(req.params.id);
    const memAcc = memoryAccounts.get(req.params.id);
    if (memAcc) memAcc.status = 'disconnected';
    res.json({ status: 'disconnected' });
  });

  // Actualizar cuenta (por ejemplo: cambiar flujo, proveedor o credenciales)
  r.put('/:id', requireRole('admin'), validateBody(updateAccountSchema), async (req, res) => {
    const { name, phone_number, channel, external_id, access_token, app_secret, verify_token, provider, flow_id, reminder_minutes,
            ai_support_enabled, ai_api_key, ai_model, ai_support_prompt } = req.body;
    const accountId = req.params.id;

    const memAcc = memoryAccounts.get(accountId);
    const useSupabase = isSupabaseConfigured && !memAcc;

    if (useSupabase) {
      // Estado actual: para decidir si hace falta reconectar el transporte.
      const { data: current } = await supabase
        .from('accounts')
        .select('channel, provider, external_id, access_token, app_secret, verify_token')
        .eq('id', accountId)
        .maybeSingle();

      // Solo actualizar campos provistos (evita nullear columnas en updates parciales).
      const patch: Record<string, any> = {};
      if (name !== undefined) patch.name = name;
      if (phone_number !== undefined) patch.phone_number = phone_number;
      if (channel !== undefined) patch.channel = channel;
      if (external_id !== undefined) patch.external_id = external_id;
      if (access_token !== undefined) patch.access_token = access_token;
      if (app_secret !== undefined) patch.app_secret = app_secret;
      if (verify_token !== undefined) patch.verify_token = verify_token;
      if (provider !== undefined) patch.provider = provider;
      if (flow_id !== undefined) patch.flow_id = flow_id || null;
      if (reminder_minutes !== undefined) patch.reminder_minutes = Number(reminder_minutes) || 20;
      if (ai_support_enabled !== undefined) patch.ai_support_enabled = !!ai_support_enabled;
      if (ai_api_key !== undefined) patch.ai_api_key = ai_api_key || null;
      if (ai_model !== undefined) patch.ai_model = ai_model || 'gpt-4o-mini';
      if (ai_support_prompt !== undefined) patch.ai_support_prompt = ai_support_prompt || null;

      const { data, error } = await supabase
        .from('accounts')
        .update(patch)
        .eq('id', accountId)
        .select('*')
        .single();
      if (error) return res.status(400).json({ error: error.message });

      if (flow_id) {
        await supabase
          .from('flows')
          .update({ account_id: accountId })
          .eq('id', flow_id);
      }

      // Reconectar SOLO si cambió el transporte (canal/proveedor/credenciales).
      // Desconectar por un cambio de flujo tira la sesión de WhatsApp y el bot deja
      // de contestar: el flujo se resuelve por-mensaje, no necesita reconexión.
      const transportChanged = !!current && (
        (channel !== undefined && channel !== current.channel) ||
        (provider !== undefined && provider !== current.provider) ||
        (external_id !== undefined && external_id !== current.external_id) ||
        (access_token !== undefined && access_token !== current.access_token) ||
        (app_secret !== undefined && app_secret !== current.app_secret) ||
        (verify_token !== undefined && verify_token !== current.verify_token)
      );
      if (transportChanged) {
        await manager.disconnect(accountId).catch(() => {});
      }

      return res.json(data);
    }

    // Fallback: in-memory
    if (!memAcc) return res.status(404).json({ error: 'Cuenta no encontrada' });

    if (flow_id) {
      const flow = memoryFlows.get(flow_id);
      if (flow) {
        flow.account_id = accountId;
        memoryFlows.set(flow_id, flow);
      }
    }

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

  // Eliminar cuenta (número). CASCADE en Supabase limpia flows, conversaciones,
  // mensajes y sesiones de esa cuenta. También cierra el socket y borra la sesión Baileys.
  r.delete('/:id', requireRole('admin'), async (req, res) => {
    const accountId = req.params.id;
    console.log(`[accounts] DELETE recibido para ${accountId}`);

    // 1. Detener y sacar el cliente del manager (cierra socket).
    await manager.disconnect(accountId).catch(() => {});

    // 2. Memoria (cuenta + sus flows en memoria) si aplica.
    const memAcc = memoryAccounts.get(accountId);
    if (memAcc) {
      memoryAccounts.delete(accountId);
      for (const [fid, f] of memoryFlows) {
        if (f.account_id === accountId) memoryFlows.delete(fid);
      }
    }

    // 3. Supabase (CASCADE).
    if (isSupabaseConfigured && !memAcc) {
      const { error } = await supabase.from('accounts').delete().eq('id', accountId);
      if (error) return res.status(400).json({ error: error.message });
    }

    // 4. Best-effort: borrar credenciales Baileys de la cuenta.
    try {
      const dir = authDir(AUTH_BASE_PATH, accountId);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (e: any) {
      console.warn(`[accounts] no se pudo borrar authDir de ${accountId}: ${e?.message ?? e}`);
    }

    console.log(`[accounts] DELETE ok para ${accountId}`);
    res.json({ ok: true });
  });

  return r;
}

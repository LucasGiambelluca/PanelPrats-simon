import { Router } from 'express';
import { supabase } from '../../config/supabase';
import type { AccountManager } from '../../core/accounts/AccountManager';

export function accountsRouter(manager: AccountManager): Router {
  const r = Router();

  // Crear cuenta (fila en accounts; el user_id viene del frontend autenticado o del body)
  r.post('/', async (req, res) => {
    const { user_id, name, phone_number } = req.body;
    const { data, error } = await supabase
      .from('accounts')
      .insert({ user_id, name, phone_number, status: 'disconnected' })
      .select('*')
      .single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // Listar cuentas de un usuario
  r.get('/', async (req, res) => {
    const userId = req.query.user_id as string;
    const { data, error } = await supabase.from('accounts').select('*').eq('user_id', userId);
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // Conectar (levanta Baileys → genera QR)
  r.post('/:id/connect', async (req, res) => {
    await manager.connect(req.params.id);
    res.json({ status: manager.getStatus(req.params.id) });
  });

  // QR de la cuenta
  r.get('/:id/qr', (req, res) => {
    res.json({ qr: manager.getQr(req.params.id), status: manager.getStatus(req.params.id) });
  });

  // Estado
  r.get('/:id/status', (req, res) => {
    res.json({ status: manager.getStatus(req.params.id) });
  });

  // Desconectar
  r.post('/:id/disconnect', async (req, res) => {
    await manager.disconnect(req.params.id);
    res.json({ status: 'disconnected' });
  });

  return r;
}

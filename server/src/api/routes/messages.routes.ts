import { Router } from 'express';
import type { AccountManager } from '../../core/accounts/AccountManager';

export function messagesRouter(manager: AccountManager): Router {
  const r = Router();

  // Enviar mensaje manual (handover): envía por Baileys y persiste OUTBOUND
  r.post('/send', async (req, res) => {
    const { account_id, phone, text } = req.body;
    try {
      const r = await manager.sendMessage(account_id, phone, text);
      res.json({ ok: true, resolved: r?.resolved !== false });
    } catch (e: any) {
      res.status(400).json({ error: e.message });
    }
  });

  return r;
}

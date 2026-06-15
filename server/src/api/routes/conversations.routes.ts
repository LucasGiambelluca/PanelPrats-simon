import { Router } from 'express';
import { supabase } from '../../config/supabase';

export function conversationsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const accountId = req.query.account_id as string;
    const { data, error } = await supabase.from('whatsapp_conversations').select('*').eq('account_id', accountId).order('last_message_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.get('/:id/messages', async (req, res) => {
    const { data, error } = await supabase.from('whatsapp_messages').select('*').eq('conversation_id', req.params.id).order('timestamp', { ascending: true });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  // Handover manual: tomar / liberar
  r.post('/:id/handover', async (req, res) => {
    const status = req.body.resume ? 'BOT' : 'HANDOVER';
    const { error } = await supabase.from('whatsapp_conversations').update({ status }).eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ status });
  });

  return r;
}

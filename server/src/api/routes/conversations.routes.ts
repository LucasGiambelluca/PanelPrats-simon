import { Router } from 'express';
import { supabase } from '../../config/supabase';

export function conversationsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const accountId = req.query.account_id as string;
    // account_id ausente o 'all' => bandeja unificada (todas las líneas del estudio).
    let q = supabase
      .from('whatsapp_conversations')
      .select('*')
      .order('last_message_at', { ascending: false })
      .limit(500);
    if (accountId && accountId !== 'all') q = q.eq('account_id', accountId);
    const { data, error } = await q;
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
    const resume = !!req.body.resume;
    const status = resume ? 'BOT' : 'HANDOVER';

    const { data: conv } = await supabase
      .from('whatsapp_conversations').select('account_id, phone').eq('id', req.params.id).maybeSingle();

    const { error } = await supabase
      .from('whatsapp_conversations')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });

    // Al DEVOLVER al bot: archivar la sesión que quedó en HANDOVER. Si no, findActiveSession
    // (busca active/waiting_input) no la encuentra y el bot queda mudo. Archivarla hace que
    // el próximo mensaje arranque el flujo por defecto limpio → el bot vuelve a responder.
    if (resume && conv) {
      await supabase
        .from('flow_executions')
        .update({ status: 'archived', archived_reason: 'handover_resumed' })
        .eq('account_id', conv.account_id)
        .eq('phone', conv.phone)
        .eq('status', 'HANDOVER');
    }

    res.json({ status });
  });

  return r;
}

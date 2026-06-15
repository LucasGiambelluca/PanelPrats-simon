import { Router } from 'express';
import { supabase } from '../../config/supabase';

export function flowsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const accountId = req.query.account_id as string;
    const { data, error } = await supabase.from('flows').select('*').eq('account_id', accountId).order('created_at', { ascending: false });
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.get('/:id', async (req, res) => {
    const { data, error } = await supabase.from('flows').select('*').eq('id', req.params.id).single();
    if (error) return res.status(404).json({ error: error.message });
    res.json(data);
  });

  r.post('/', async (req, res) => {
    const { account_id, name, trigger_word, nodes, edges, is_active } = req.body;
    const { data, error } = await supabase.from('flows').insert({ account_id, name, trigger_word, nodes, edges, is_active }).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.put('/:id', async (req, res) => {
    const { name, trigger_word, nodes, edges, is_active } = req.body;
    const { data, error } = await supabase.from('flows').update({ name, trigger_word, nodes, edges, is_active, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
    if (error) return res.status(400).json({ error: error.message });
    res.json(data);
  });

  r.delete('/:id', async (req, res) => {
    const { error } = await supabase.from('flows').delete().eq('id', req.params.id);
    if (error) return res.status(400).json({ error: error.message });
    res.json({ ok: true });
  });

  return r;
}

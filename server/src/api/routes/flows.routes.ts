import { Router } from 'express';
import { supabase } from '../../config/supabase';
import crypto from 'crypto';

// In-memory store as fallback when Supabase is not configured
const memoryFlows: Map<string, any> = new Map();

const isSupabaseConfigured = !!(
  process.env.SUPABASE_URL &&
  process.env.SUPABASE_SERVICE_KEY &&
  !process.env.SUPABASE_URL.includes('TUPROYECTO') &&
  !process.env.SUPABASE_SERVICE_KEY.includes('...')
);

export function flowsRouter(): Router {
  const r = Router();

  r.get('/', async (req, res) => {
    const accountId = req.query.account_id as string;

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('flows').select('*').eq('account_id', accountId).order('created_at', { ascending: false });
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    }

    // Fallback: in-memory
    const list = Array.from(memoryFlows.values()).filter(
      f => !accountId || f.account_id === accountId
    ).sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    res.json(list);
  });

  r.get('/:id', async (req, res) => {
    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('flows').select('*').eq('id', req.params.id).single();
      if (error) return res.status(404).json({ error: error.message });
      return res.json(data);
    }

    // Fallback: in-memory
    const flow = memoryFlows.get(req.params.id);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(flow);
  });

  r.post('/', async (req, res) => {
    const { account_id, name, trigger_word, nodes, edges, is_active } = req.body;

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('flows').insert({ account_id, name, trigger_word, nodes, edges, is_active }).select('*').single();
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    }

    // Fallback: in-memory
    const id = crypto.randomUUID();
    const newFlow = {
      id,
      account_id,
      name,
      trigger_word,
      nodes,
      edges,
      is_active: is_active ?? true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    memoryFlows.set(id, newFlow);
    console.log(`📝 [memory] Flow created: ${name} (${id})`);
    res.json(newFlow);
  });

  r.put('/:id', async (req, res) => {
    const { name, trigger_word, nodes, edges, is_active } = req.body;

    if (isSupabaseConfigured) {
      const { data, error } = await supabase.from('flows').update({ name, trigger_word, nodes, edges, is_active, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
      if (error) return res.status(400).json({ error: error.message });
      return res.json(data);
    }

    // Fallback: in-memory
    const existing = memoryFlows.get(req.params.id);
    if (!existing) return res.status(404).json({ error: 'Flow not found' });

    const updatedFlow = {
      ...existing,
      name: name !== undefined ? name : existing.name,
      trigger_word: trigger_word !== undefined ? trigger_word : existing.trigger_word,
      nodes: nodes !== undefined ? nodes : existing.nodes,
      edges: edges !== undefined ? edges : existing.edges,
      is_active: is_active !== undefined ? is_active : existing.is_active,
      updated_at: new Date().toISOString()
    };
    memoryFlows.set(req.params.id, updatedFlow);
    console.log(`📝 [memory] Flow updated: ${updatedFlow.name} (${req.params.id})`);
    res.json(updatedFlow);
  });

  r.delete('/:id', async (req, res) => {
    if (isSupabaseConfigured) {
      const { error } = await supabase.from('flows').delete().eq('id', req.params.id);
      if (error) return res.status(400).json({ error: error.message });
      return res.json({ ok: true });
    }

    // Fallback: in-memory
    if (!memoryFlows.has(req.params.id)) {
      return res.status(404).json({ error: 'Flow not found' });
    }
    memoryFlows.delete(req.params.id);
    console.log(`🗑️ [memory] Flow deleted: ${req.params.id}`);
    res.json({ ok: true });
  });

  return r;
}

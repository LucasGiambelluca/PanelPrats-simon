import { Router } from 'express';
import { supabase } from '../../config/supabase';
import crypto from 'crypto';
import { memoryAccounts, memoryFlows } from '../../core/accounts/memoryStore';
import { FlowEngine } from '../../core/engine/flow.engine';

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
    const userId = req.query.user_id as string;
    const isMemoryAccount = accountId ? memoryAccounts.has(accountId) : false;
    const useSupabase = isSupabaseConfigured && !isMemoryAccount;

    let dbFlows: any[] = [];
    if (useSupabase) {
      try {
        let query = supabase.from('flows').select('*').order('created_at', { ascending: false });
        if (accountId && accountId.trim() !== '') {
          // Flujos de una cuenta puntual.
          query = query.eq('account_id', accountId);
        } else if (userId && userId.trim() !== '') {
          // Todos los flujos del usuario (across cuentas) para poder editarlos desde el bot builder.
          const { data: accs } = await supabase.from('accounts').select('id').eq('user_id', userId);
          const ids = (accs || []).map((a: any) => a.id);
          // Sentinela imposible si el usuario no tiene cuentas → devuelve vacío en vez de TODO.
          query = query.in('account_id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
        }
        const { data, error } = await query;
        if (!error && data) {
          dbFlows = data;
        }
      } catch (err: any) {
        // ignore and fallback
      }
    }

    // Always fetch and merge matching memory flows
    const memFlows = Array.from(memoryFlows.values()).sort(
      (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
    );
    const filteredMemFlows = accountId && accountId.trim() !== ''
      ? memFlows.filter(f => f.account_id === accountId)
      : memFlows;

    // Merge both lists, removing duplicates by ID just in case
    const merged = [...dbFlows];
    const seenIds = new Set(merged.map(f => f.id));
    for (const f of filteredMemFlows) {
      if (!seenIds.has(f.id)) {
        merged.push(f);
      }
    }

    res.json(merged);
  });

  r.get('/:id', async (req, res) => {
    const isMemoryFlow = memoryFlows.has(req.params.id);
    const useSupabase = isSupabaseConfigured && !isMemoryFlow;

    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('flows').select('*').eq('id', req.params.id).single();
        if (!error && data) return res.json(data);
      } catch (err: any) {
        // fallback
      }
    }

    // Fallback: in-memory
    const flow = memoryFlows.get(req.params.id);
    if (!flow) return res.status(404).json({ error: 'Flow not found' });
    res.json(flow);
  });

  r.post('/', async (req, res) => {
    const { account_id, name, trigger_word, nodes, edges, is_active } = req.body;
    const isMemoryAccount = account_id ? memoryAccounts.has(account_id) : false;
    const useSupabase = isSupabaseConfigured && !isMemoryAccount;

    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('flows').insert({ account_id, name, trigger_word, nodes, edges, is_active }).select('*').single();
        if (!error && data) { FlowEngine.invalidateFlowCache(account_id); return res.json(data); }
        if (error) return res.status(400).json({ error: error.message });
      } catch (err: any) {
        // fallback
      }
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
    FlowEngine.invalidateFlowCache(account_id);
    console.log(`📝 [memory] Flow created: ${name} (${id})`);
    res.json(newFlow);
  });

  r.put('/:id', async (req, res) => {
    const { name, trigger_word, nodes, edges, is_active } = req.body;
    const isMemoryFlow = memoryFlows.has(req.params.id);
    const useSupabase = isSupabaseConfigured && !isMemoryFlow;

    if (useSupabase) {
      try {
        const { data, error } = await supabase.from('flows').update({ name, trigger_word, nodes, edges, is_active, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('*').single();
        if (!error && data) { FlowEngine.invalidateFlowCache(data.account_id); return res.json(data); }
        if (error) return res.status(400).json({ error: error.message });
      } catch (err: any) {
        // fallback
      }
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
    FlowEngine.invalidateFlowCache(updatedFlow.account_id);
    console.log(`📝 [memory] Flow updated: ${updatedFlow.name} (${req.params.id})`);
    res.json(updatedFlow);
  });

  r.delete('/:id', async (req, res) => {
    const isMemoryFlow = memoryFlows.has(req.params.id);
    const useSupabase = isSupabaseConfigured && !isMemoryFlow;

    if (useSupabase) {
      try {
        const { error } = await supabase.from('flows').delete().eq('id', req.params.id);
        if (!error) { FlowEngine.invalidateFlowCache(); return res.json({ ok: true }); }
        if (error) return res.status(400).json({ error: error.message });
      } catch (err: any) {
        // fallback
      }
    }

    // Fallback: in-memory
    if (!memoryFlows.has(req.params.id)) {
      return res.status(404).json({ error: 'Flow not found' });
    }
    memoryFlows.delete(req.params.id);
    FlowEngine.invalidateFlowCache();
    console.log(`🗑️ [memory] Flow deleted: ${req.params.id}`);
    res.json({ ok: true });
  });

  return r;
}

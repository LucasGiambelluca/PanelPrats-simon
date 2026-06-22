import { AgentRuntime } from './AgentRuntime';
import { ToolRegistry } from './ToolRegistry';
import { KnowledgeBase } from './KnowledgeBase';
import { ContactMemory } from './ContactMemory';
import { buildPersona } from './AgentPersona';
import { AIService } from '../../../services/AIService';
import { extractMemoryPatch } from './MemoryUpdater';
import { AppointmentService } from '../../../services/AppointmentService';
import { supabase } from '../../../config/supabase';
import { redisPersistence } from '../../../infrastructure/persistence/RedisPersistenceService';

async function loadAccount(accountId: string) {
  const { data } = await supabase.from('accounts')
    .select('id, name, agent_name, agent_persona, business_context, ai_api_key, ai_model')
    .eq('id', accountId).maybeSingle();
  return {
    accountId,
    agentName: data?.agent_name ?? 'Sofía',
    agentPersona: data?.agent_persona ?? null,
    businessContext: data?.business_context ?? null,
    estudioNombre: data?.name ?? null,
    apiKey: data?.ai_api_key ?? null,
    model: data?.ai_model ?? null,
  };
}

// Historial reciente como Array<{role:'user'|'assistant', content}>.
// Fuente real: RedisPersistenceService.getHistory, que ya mapea
// direction OUTBOUND→'assistant', INBOUND→'user' desde whatsapp_messages.
async function recentHistory(accountId: string, phone: string): Promise<Array<{ role: 'user' | 'assistant'; content: string }>> {
  const rows = await redisPersistence.getHistory(accountId, phone, 12);
  return (rows ?? [])
    .filter((m) => m && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
}

// Reutiliza la lógica real de handover (la misma que HandoverExecutor /
// ConversationRouter.setHandover): pone flow_executions + whatsapp_conversations
// en HANDOVER para que el bot calle y la conversación pase a Atención. Best-effort.
async function handoff(accountId: string, phone: string, _payload: { motivo: string; resumen_caso: string }): Promise<void> {
  try {
    await supabase.from('flow_executions')
      .update({ status: 'HANDOVER' })
      .eq('account_id', accountId)
      .eq('phone', phone)
      .eq('status', 'active');
    await supabase.from('whatsapp_conversations')
      .update({ status: 'HANDOVER', updated_at: new Date().toISOString() })
      .eq('account_id', accountId)
      .eq('phone', phone);
  } catch (e: any) {
    console.warn(`[createAgentRuntime] handoff error for ${phone}:`, e?.message || e);
  }
}

let singleton: AgentRuntime | null = null;
export function getAgentRuntime(): AgentRuntime {
  if (singleton) return singleton;
  const knowledge = new KnowledgeBase();
  const memory = new ContactMemory();
  const tools = new ToolRegistry({ appointments: AppointmentService, knowledge, handoff });
  singleton = new AgentRuntime({
    ai: { completeWithTools: (o) => AIService.completeWithTools(o) },
    persona: { build: buildPersona },
    memory: { load: (a, p) => memory.load(a, p) },
    tools: { schemas: () => tools.schemas(), execute: (n, args, ctx) => tools.execute(n, args, ctx) },
    loadAccount,
    history: recentHistory,
    updateMemory: async (accountId, phone, turns) => {
      const patch = await extractMemoryPatch({ complete: (o) => AIService.complete(o) }, turns);
      await memory.merge(accountId, phone, patch);
    },
  });
  return singleton;
}

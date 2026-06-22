import type { ToolContext } from './types';

const MAX_ITERATIONS = 5;
const FALLBACK = 'Disculpá, esto mejor lo ve una persona del estudio. Ya te derivo. 🙌';

// Dependencias inyectadas (facilita el test y respeta el aislamiento).
export interface RuntimeDeps {
  ai: { completeWithTools: (opts: any) => Promise<{ content?: string; toolCalls?: Array<{ id: string; name: string; args: any }> }> };
  persona: { build: (account: any, fichaText: string) => string };
  memory: { load: (accountId: string, phone: string) => Promise<{ fichaText: string }> };
  tools: { schemas: () => any[]; execute: (name: string, args: any, ctx: ToolContext) => Promise<{ ok: boolean; data?: any; error?: string }> };
  loadAccount: (accountId: string) => Promise<any>;
  history: (accountId: string, phone: string) => Promise<Array<{ role: 'user' | 'assistant'; content: string }>>;
  updateMemory?: (accountId: string, phone: string, turns: Array<{ role: string; content: string }>) => Promise<void>;
}

export class AgentRuntime {
  constructor(private deps: RuntimeDeps) {}

  /** Procesa un mensaje entrante y devuelve los mensajes a enviar. */
  async handle(accountId: string, phone: string, text: string, _fileCtx: any = {}): Promise<string[]> {
    const ctx: ToolContext = { accountId, phone };
    const [account, ficha, history] = await Promise.all([
      this.deps.loadAccount(accountId),
      this.deps.memory.load(accountId, phone),
      this.deps.history(accountId, phone),
    ]);

    const systemPrompt = this.deps.persona.build(account, ficha.fichaText);
    const tools = this.deps.tools.schemas();
    const messages: any[] = [...history, { role: 'user', content: text }];

    const finish = (reply: string): string[] => {
      const turns = messages
        .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
        .map((m) => ({ role: m.role, content: m.content }));
      turns.push({ role: 'assistant', content: reply });
      this.deps.updateMemory?.(accountId, phone, turns)?.catch(() => { /* best-effort */ });
      return [reply];
    };

    for (let i = 0; i < MAX_ITERATIONS; i++) {
      const res = await this.deps.ai.completeWithTools({
        systemPrompt, messages, tools, apiKey: account?.apiKey, model: account?.model,
      });

      if (!res.toolCalls?.length) {
        const reply = res.content && res.content.trim() ? res.content.trim() : FALLBACK;
        return finish(reply);
      }

      messages.push({ role: 'assistant', content: '', tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.args) } })) });
      for (const call of res.toolCalls) {
        const result = await this.deps.tools.execute(call.name, call.args, ctx);
        messages.push({ role: 'tool', tool_call_id: call.id, name: call.name, content: JSON.stringify(result) });
      }
    }

    // Excedió iteraciones: cortar y derivar (nunca colgar al cliente).
    return finish(FALLBACK);
  }
}

import type { Change, BrainState } from './types';
import type { ConfigToolRegistry } from './ConfigToolRegistry';

export interface ConfigAgentDeps {
  ai: { completeWithTools: (opts: any) => Promise<{ content?: string; toolCalls?: Array<{ id: string; name: string; args: any }> }> };
  registry: ConfigToolRegistry;
  apiKey?: string;
  model?: string;
}

const DEFAULT_REPLY = 'Preparé los cambios, revisalos abajo y aplicá si está bien. 👇';

function buildSystemPrompt(state: BrainState): string {
  const faqs = state.faqs.length ? state.faqs.map((f) => `- ${f.pregunta} → ${f.respuesta}`).join('\n') : '(sin FAQs)';
  const zonas = state.zonas.length ? state.zonas.map((z) => `- ${z.alias} → ${z.oficina}`).join('\n') : '(sin zonas)';
  return [
    'Sos el asistente de configuración del "cerebro" del agente de atención de un estudio previsional.',
    'El admin te da órdenes en lenguaje natural para mejorar la atención. Para CADA pedido, llamá la/las',
    'tools correspondientes con el cambio propuesto. NO confirmes vos: el admin confirma después.',
    'Si el pedido no implica un cambio concreto, respondé con texto pidiendo precisión.',
    '',
    'ESTADO ACTUAL DEL CEREBRO:',
    `TONO: ${state.tono ?? '(vacío)'}`,
    `DATOS: ${state.datos ?? '(vacío)'}`,
    `PROCEDIMIENTOS: ${state.procedimientos ?? '(vacío)'}`,
    `FAQs:\n${faqs}`,
    `ZONAS:\n${zonas}`,
  ].join('\n');
}

export class ConfigAgent {
  constructor(private deps: ConfigAgentDeps) {}

  async handle(messages: Array<{ role: 'user' | 'assistant'; content: string }>, state: BrainState): Promise<{ reply: string; pendingChanges: Change[] }> {
    let res: { content?: string; toolCalls?: Array<{ id: string; name: string; args: any }> };
    try {
      res = await this.deps.ai.completeWithTools({
        systemPrompt: buildSystemPrompt(state),
        messages,
        tools: this.deps.registry.schemas(),
        apiKey: this.deps.apiKey,
        model: this.deps.model ?? 'gpt-4o',
      });
    } catch {
      // El proveedor de IA falló (sin saldo, caído, sin key): no reventamos el endpoint
      // — devolvemos un aviso claro y el admin igual puede editar el cerebro a mano.
      return { reply: 'No pude conectarme al modelo (revisá la API key de OpenAI / saldo). Igual podés editar el cerebro a mano en los paneles de la izquierda.', pendingChanges: [] };
    }
    if (!res.toolCalls?.length) {
      return { reply: (res.content && res.content.trim()) || '¿Qué querés ajustar del agente?', pendingChanges: [] };
    }
    const pendingChanges = res.toolCalls
      .map((c) => this.deps.registry.toChange(c.name, c.args))
      .filter((c): c is Change => c !== null);
    return { reply: (res.content && res.content.trim()) || DEFAULT_REPLY, pendingChanges };
  }
}

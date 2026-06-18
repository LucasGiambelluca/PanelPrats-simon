import { FlowEngine } from './flow.engine';
import { supabase } from '../../config/supabase';
import { SupportAgentService } from '../../services/SupportAgentService';

const DEFAULT_HANDOFF_MESSAGE = 'Te derivo con un asesor humano, aguardá un momento por favor. 🙌';

const CANCEL_WORDS = ['cancelar', 'salir', 'chau', 'reset', 'reiniciar'];
const GREETING_WORDS = ['hola', 'menu', 'menú', 'inicio'];
const GLOBAL_BREAKERS = ['hola', 'menu', 'menú', 'cancelar', 'salir', 'reset', 'reiniciar', 'inicio'];

function norm(t: string): string {
  return (t || '').trim().toLowerCase();
}

export class ConversationRouter {
  constructor(private engine: FlowEngine) {}

  /** Devuelve los mensajes a enviar (strings/objetos). */
  async processMessage(accountId: string, phone: string, text: string, pushName: string, fileCtx: any = {}): Promise<any[]> {
    const t = norm(text);
    const baseCtx = { accountId, phone, pushName, user_message: text, ...fileCtx };

    // P0 — cancelar explícito
    if (CANCEL_WORDS.includes(t)) {
      await this.engine.forceReset(accountId, phone);
      return ['Listo, reiniciamos. Escribí *hola* para empezar de nuevo. 👋'];
    }

    const status = await this.getConversationStatus(accountId, phone);

    // Saludo / "menu" / "inicio" → reiniciar al router de entrada. Limpia la sesión
    // y, si estaba tomada por humano (HANDOVER), la devuelve al bot. Sin esto, al no
    // existir ya un wildcard que matchee "hola", el motor dejaba al bot mudo en HANDOVER.
    if (GREETING_WORDS.includes(t)) {
      await this.engine.forceReset(accountId, phone);
      if (status === 'HANDOVER') {
        try {
          await supabase.from('whatsapp_conversations')
            .update({ status: 'BOT', updated_at: new Date().toISOString() })
            .eq('account_id', accountId).eq('phone', phone);
        } catch (e: any) {
          console.warn(`[ConversationRouter] no se pudo limpiar HANDOVER en saludo:`, e?.message || e);
        }
      }
      // continúa al motor: con sesión limpia y sin HANDOVER, corre el router (account.flow_id)
    } else if (status === 'HANDOVER') {
      // Tomada por humano y no es saludo → el bot calla.
      return [];
    }

    // Al motor con el texto REAL: el matching de trigger (exacto/parcial/wildcard)
    // resuelve qué flujo corre. No reescribir saludos a 'hola' — eso hacía que
    // "Menu" (u otros triggers) nunca llegaran a su flujo y cayeran siempre al wildcard.
    const result = await this.engine.processMessage(accountId, phone, text, baseCtx);
    const def = result?.currentStateDefinition;

    // ── Agente IA de soporte global ───────────────────────────────────────────
    // El motor señala dos casos donde el mensaje quedó "sin destino":
    //  - _no_flow_match: off-script, no matcheó ningún trigger y no hay sesión.
    //  - _restart_ai:    el usuario respondió algo inesperado dentro de un flujo.
    // En ambos, el agente entiende la intención y rutea al flujo correcto, o deriva.
    // Pre-menú: el mensaje en frío caería a un flujo wildcard (catch-all / menú).
    // Le damos primero la chance al agente de rutear directo al flujo correcto.
    if (def?._wildcard_pending) {
      const runWildcardMenu = async () => {
        const menu = await this.engine.processMessage(accountId, phone, text, baseCtx, { flowId: def._wildcardFlowId });
        return this.extractMessages(menu?.currentStateDefinition?.message_template);
      };

      // Saludos / palabras de menú: mostrar el menú directamente (no gastar IA ni
      // arriesgar derivar un "hola" a un flujo equivocado).
      if (GLOBAL_BREAKERS.includes(t)) return runWildcardMenu();

      const decision = await SupportAgentService.resolve({ accountId, text, pushName });
      if (decision.action === 'route' && decision.trigger) {
        const routed = await this.engine.processMessage(accountId, phone, decision.trigger, baseCtx);
        return this.extractMessages(routed?.currentStateDefinition?.message_template);
      }
      // No se pudo rutear (handoff/none): el menú wildcard es el fallback natural.
      return runWildcardMenu();
    }

    if (def?._no_flow_match || def?._restart_ai) {
      const ai = def?._aiResult || {};

      // Si el Supervisor IA (mid-flow) YA decidió, lo honramos sin re-llamar a la IA.
      if (ai.route) {
        const routed = await this.engine.processMessage(accountId, phone, ai.route, baseCtx);
        return this.extractMessages(routed?.currentStateDefinition?.message_template);
      }
      if (ai.handoff) {
        await this.setHandover(accountId, phone);
        return [DEFAULT_HANDOFF_MESSAGE];
      }

      // Sin decisión previa (off-script al inicio, o poll sin supervisor): el Agente
      // de soporte global decide a qué flujo rutear o si deriva.
      const decision = await SupportAgentService.resolve({ accountId, text, pushName });

      if (decision.action === 'route' && decision.trigger) {
        // Reingreso: re-procesamos como si el usuario hubiera tipeado el trigger
        // del flujo destino. El motor hace forceReset y arranca ese flujo.
        const routed = await this.engine.processMessage(accountId, phone, decision.trigger, baseCtx);
        return this.extractMessages(routed?.currentStateDefinition?.message_template);
      }

      if (decision.action === 'handoff') {
        await this.setHandover(accountId, phone);
        return [DEFAULT_HANDOFF_MESSAGE];
      }

      // 'none' (sin IA configurada): mantener comportamiento previo.
      // Si veníamos de un flujo (re-prompt mid-flow), usar ese mensaje de fallback.
      if (def?._restart_ai && ai.fallbackMessage) {
        return this.extractMessages(ai.fallbackMessage);
      }
      return [];
    }

    return this.extractMessages(def?.message_template);
  }

  private extractMessages(template: any): any[] {
    if (Array.isArray(template)) return template;
    if (typeof template === 'string') return [template];
    return [];
  }

  /** Pone la conversación en HANDOVER: el bot calla y pasa a la pestaña Atención. */
  private async setHandover(accountId: string, phone: string): Promise<void> {
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
      console.warn(`[ConversationRouter] setHandover error for ${phone}:`, e?.message || e);
    }
  }

  private async getConversationStatus(accountId: string, phone: string): Promise<string | null> {
    try {
      const { data } = await supabase
        .from('whatsapp_conversations')
        .select('status')
        .eq('account_id', accountId)
        .eq('phone', phone)
        .maybeSingle();
      return (data?.status as string) ?? null;
    } catch (e: any) {
      console.warn(`[ConversationRouter] error fetching conversation status for phone ${phone}:`, e?.message || e);
      return null;
    }
  }
}

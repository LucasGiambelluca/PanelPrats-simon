import type { AccountManager } from '../core/accounts/AccountManager';
import { messageStore } from './MessageStore';
import { supabase } from '../config/supabase';

/**
 * NudgeScheduler — recordatorio proactivo cuando el contacto deja una pregunta sin
 * responder. Cada minuto revisa las sesiones en `waiting_input` y, si el nodo actual
 * tiene configurado `nudgeText`, manda ese texto pasados `nudgeAfterSec` segundos sin
 * respuesta (default 120s). Idempotente por nodo: no repite el mismo empujón.
 *
 * Reglas:
 *  - Solo nodos con `data.nudgeText` (opt-in por nodo en el flujo).
 *  - Solo dentro de la ventana de 24h (mensaje libre): debe haber un entrante reciente.
 *  - Solo si la cuenta está conectada.
 *  - Marca `context.metadata.nudgeSentNode` = nodo actual → no repite.
 */
export class NudgeScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  private readonly TICK_MS = 60 * 1000;
  private readonly MIN_AGE_MS = 60 * 1000;          // no nudgear sesiones de <1min
  private readonly WINDOW_24H_MS = 24 * 60 * 60 * 1000;
  private readonly DEFAULT_NUDGE_SEC = 120;

  constructor(private manager: AccountManager) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error('[NudgeScheduler] tick error:', e?.message ?? e));
    }, this.TICK_MS);
    console.log('⏰ [NudgeScheduler] activo (empujón por pregunta sin responder)');
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  private isConnected(accountId: string): boolean {
    const s = this.manager.getStatus(accountId);
    return s === 'WORKING' || s === 'connected';
  }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = Date.now();
      const oldest = new Date(now - this.WINDOW_24H_MS).toISOString();
      const newest = new Date(now - this.MIN_AGE_MS).toISOString();

      // Sesiones esperando respuesta, con inactividad entre 1min y 24h.
      const { data: sessions } = await supabase
        .from('flow_executions')
        .select('id, account_id, flow_id, phone, current_node_id, context, last_activity')
        .eq('status', 'waiting_input')
        .lt('last_activity', newest)
        .gt('last_activity', oldest)
        .limit(200);

      if (!sessions || sessions.length === 0) return;

      // Cargar (una vez) los flujos involucrados.
      const flowIds = [...new Set(sessions.map((s: any) => s.flow_id).filter(Boolean))];
      const { data: flows } = await supabase.from('flows').select('id, nodes').in('id', flowIds);
      const nodesByFlow = new Map<string, any[]>((flows ?? []).map((f: any) => [f.id, f.nodes || []]));

      for (const s of sessions as any[]) {
        const nodes = nodesByFlow.get(s.flow_id);
        if (!nodes) continue;
        const node = nodes.find((n: any) => n.id === s.current_node_id);
        const nudgeText: string | undefined = node?.data?.nudgeText;
        if (!nudgeText) continue; // opt-in: solo nodos con nudge configurado

        const nudgeSec = Number(node?.data?.nudgeAfterSec) > 0 ? Number(node.data.nudgeAfterSec) : this.DEFAULT_NUDGE_SEC;
        const elapsedMs = now - new Date(s.last_activity).getTime();
        if (elapsedMs < nudgeSec * 1000) continue;

        const ctx = s.context || {};
        const meta = ctx.metadata || (ctx.metadata = {});
        if (meta.nudgeSentNode === s.current_node_id) continue; // ya empujado en este nodo

        if (!this.isConnected(s.account_id)) continue;

        // Ventana de 24h: debe haber un entrante del contacto en las últimas 24h.
        const lastIn = await messageStore.getLastInboundAt(s.account_id, s.phone);
        if (!lastIn || (now - lastIn.getTime()) > this.WINDOW_24H_MS) continue;

        try {
          await this.manager.sendMessage(s.account_id, s.phone, nudgeText);
          meta.nudgeSentNode = s.current_node_id;
          await supabase.from('flow_executions').update({ context: ctx }).eq('id', s.id);
          console.log(`[NudgeScheduler] empujón enviado a ${s.phone} (nodo ${s.current_node_id})`);
        } catch (err: any) {
          console.error(`[NudgeScheduler] error enviando empujón a ${s.phone}:`, err?.message ?? err);
        }
      }
    } finally {
      this.running = false;
    }
  }
}

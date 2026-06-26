import { shouldReengage } from './reengage/shouldReengage';

export const DEFAULT_REENGAGE_TEXT = '¡Buen día! ¿Seguimos con tu consulta de ayer? 🙂';

export interface ReengageConversation {
  id: string; account_id: string; phone: string; status: string;
  last_message_at: string | null; reengaged_for: string | null;
}
export interface ReengageDeps {
  listEnabledAccounts: () => Promise<Array<{ id: string; reengage_text: string | null }>>;
  listConversations: (accountId: string) => Promise<ReengageConversation[]>;
  lastInboundAt: (accountId: string, phone: string) => Promise<Date | null>;
  isConnected: (accountId: string) => boolean;
  sendMessage: (accountId: string, phone: string, text: string) => Promise<void>;
  markReengaged: (conversationId: string, lastMessageAt: string) => Promise<void>;
  now?: () => Date;
}

/**
 * NightReengageScheduler — retoma a la mañana las conversaciones cortadas de noche.
 * Patrón NudgeScheduler: tick periódico, idempotente, dentro de la ventana 24h.
 */
export class NightReengageScheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly sentThisProcess = new Set<string>(); // guard ante fallo de markReengaged
  private readonly TICK_MS = 10 * 60 * 1000;

  constructor(private deps: ReengageDeps) {}

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch((e) => console.error('[NightReengageScheduler] tick error:', e?.message ?? e));
    }, this.TICK_MS);
    console.log('⏰ [NightReengageScheduler] activo (retoma a la mañana lo cortado de noche)');
  }
  stop(): void { if (this.timer) { clearInterval(this.timer); this.timer = null; } }

  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const now = (this.deps.now ?? (() => new Date()))();
      const accounts = await this.deps.listEnabledAccounts();
      for (const acc of accounts) {
        if (!this.deps.isConnected(acc.id)) continue;
        const texto = (acc.reengage_text && acc.reengage_text.trim()) || DEFAULT_REENGAGE_TEXT;
        const convos = await this.deps.listConversations(acc.id);
        for (const c of convos) {
          if (!c.last_message_at) continue;
          const lastInbound = await this.deps.lastInboundAt(acc.id, c.phone);
          const ok = shouldReengage({
            lastMessageAt: new Date(c.last_message_at),
            reengagedFor: c.reengaged_for ? new Date(c.reengaged_for) : null,
            lastInboundAt: lastInbound,
            status: c.status,
            now,
          });
          if (!ok) continue;
          const guardKey = `${c.id}:${c.last_message_at}`;
          if (this.sentThisProcess.has(guardKey)) continue; // ya mandado en este proceso (aunque markReengaged haya fallado)
          try {
            await this.deps.sendMessage(acc.id, c.phone, texto);
            this.sentThisProcess.add(guardKey);
            await this.deps.markReengaged(c.id, c.last_message_at);
            console.log(`[NightReengageScheduler] re-enganche enviado a ${c.phone}`);
          } catch (err: any) {
            console.error(`[NightReengageScheduler] error con ${c.phone}:`, err?.message ?? err);
          }
        }
      }
    } finally {
      this.running = false;
    }
  }
}

import { supabase } from '../config/supabase';
import { messageStore } from './MessageStore';
import type { AccountManager } from '../core/accounts/AccountManager';

const WINDOW_24H_MS = 24 * 60 * 60 * 1000;

/** Construye el scheduler con las fuentes reales (Supabase + AccountManager). */
export function createNightReengageScheduler(manager: AccountManager): NightReengageScheduler {
  return new NightReengageScheduler({
    listEnabledAccounts: async () => {
      const { data } = await supabase.from('accounts').select('id, reengage_text').eq('reengage_enabled', true);
      return ((data ?? []) as any[]).map((a) => ({ id: a.id, reengage_text: a.reengage_text ?? null }));
    },
    listConversations: async (accountId) => {
      const since = new Date(Date.now() - WINDOW_24H_MS).toISOString();
      const { data } = await supabase
        .from('whatsapp_conversations')
        .select('id, account_id, phone, status, last_message_at, reengaged_for')
        .eq('account_id', accountId)
        .eq('status', 'BOT')
        .gt('last_message_at', since)
        .limit(200);
      return (data ?? []) as any[];
    },
    lastInboundAt: (accountId, phone) => messageStore.getLastInboundAt(accountId, phone),
    isConnected: (accountId) => {
      const s = manager.getStatus(accountId);
      return s === 'WORKING' || s === 'connected';
    },
    sendMessage: (accountId, phone, text) => manager.sendMessage(accountId, phone, text).then(() => undefined),
    markReengaged: async (conversationId, lastMessageAt) => {
      await supabase.from('whatsapp_conversations').update({ reengaged_for: lastMessageAt }).eq('id', conversationId);
    },
  });
}

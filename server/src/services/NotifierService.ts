import { logger } from '../utils/logger';

// Permite que executors/servicios manden un WhatsApp por la línea de una cuenta
// sin acoplarse al AccountManager. index.ts registra el sender al bootear.
type SendFn = (accountId: string, to: string, text: string) => Promise<void>;

let sender: SendFn | null = null;

export function setNotificationSender(fn: SendFn): void {
  sender = fn;
}

/** Envía un mensaje de notificación (best-effort: nunca tira). */
export async function notify(accountId: string, to: string, text: string): Promise<void> {
  if (!sender) { logger.warn('[Notifier] sender no configurado (se omite la notificación)'); return; }
  if (!to) return;
  try {
    await sender(accountId, to, text);
    logger.info(`[Notifier] notificación enviada a ${to} (cuenta ${accountId})`);
  } catch (e: any) {
    logger.warn(`[Notifier] no se pudo enviar la notificación a ${to}: ${e?.message || e}`);
  }
}

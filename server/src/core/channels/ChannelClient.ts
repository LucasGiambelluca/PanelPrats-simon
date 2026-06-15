/**
 * Interfaz común a todos los clientes de canal (WhatsApp, Facebook, Instagram).
 *
 * WhatsAppClient ya satisface start/stop/getStatus de facto; el AccountManager
 * adapta el envío (sendFormattedMessage vs sendMessage) por canal en vez de
 * forzar a WhatsAppClient a implementar esta interfaz.
 */
export interface ChannelClient {
  start(): Promise<void>;
  stop(): Promise<void>;
  getStatus(): string;
  sendMessage(to: string, text: string): Promise<void>;
}

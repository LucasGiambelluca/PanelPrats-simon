import 'dotenv/config';
import makeWASocket, { useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadMediaMessage } from '@whiskeysockets/baileys';
import pino from 'pino';
import qrcode from 'qrcode';
import { PhoneUtils } from '../../utils/phoneUtils';
import { logger } from '../../utils/logger';
import { supabase } from '../../config/supabase';
import fs from 'fs';
import { authDir } from '../../lib/account-keys';
import { default as storageService } from '../../services/storageService';
import { Mutex } from 'async-mutex';
import { ConfigurationService } from '../../services/ConfigurationService';
import type { MessageStore } from '../../services/MessageStore';

// Anti-ban configuration
const MIN_TYPING_DELAY = 300;
const MAX_TYPING_DELAY = 1000;
const MIN_SEND_DELAY = 500;
const MAX_SEND_DELAY = 1500;
const BOT_LOOP_THRESHOLD = 5;
const BOT_LOOP_WINDOW_MS = 10000;

interface MessageHistory {
    count: number;
    firstMessageAt: number;
}

const MAX_RECONNECT_ATTEMPTS = 10;

/** Estado interno del cliente Baileys (legacy: STOPPED/WORKING/SCAN_QR_CODE). */
export type WhatsAppStatus = 'STOPPED' | 'WORKING' | 'SCAN_QR_CODE';

/** Estado persistido en la tabla `accounts` (CHECK: disconnected/connecting/qr/connected). */
type AccountStatus = 'disconnected' | 'connecting' | 'qr' | 'connected';

/**
 * Cliente Baileys instanciable por cuenta.
 *
 * Cada instancia administra su propio socket, su carpeta de auth aislada
 * (`authDir(authBasePath, accountId)`), su QR y su estado, y persiste el estado
 * en la tabla `accounts`. Al recibir un mensaje lo delega a `onMessage`
 * (inyectado por AccountManager → ConversationRouter) y persiste IN/OUT vía `store`.
 */
export class WhatsAppClient {
    private sock: any = null;
    private qrCodeData: string | null = null;
    private status: WhatsAppStatus = 'STOPPED';
    private reconnectAttempts = 0;
    private sessionClearFailed = false; // Flag to prevent infinite restart loops
    private readonly authDirPath: string;

    // Anti-ban state
    private sendMutex = new Mutex();
    private userSendHistory: Map<string, MessageHistory> = new Map();
    private lastMessages: Map<string, number> = new Map();
    private cleanupInterval: NodeJS.Timeout | null = null;

    constructor(
        private accountId: string,
        private authBasePath: string,
        private onMessage: (accountId: string, phone: string, text: string, pushName: string, fileCtx: any) => Promise<any[]>,
        private store: MessageStore,
    ) {
        this.authDirPath = authDir(this.authBasePath, this.accountId);
    }

    public getSock() {
        return this.sock;
    }

    public getStatus() {
        return this.status;
    }

    public getQrCode() {
        return this.qrCodeData;
    }

    /** Persiste estado (+ QR opcional) de la cuenta en la tabla `accounts`. */
    private async persistAccountStatus(status: AccountStatus, qrCode: string | null = null): Promise<void> {
        try {
            await supabase
                .from('accounts')
                .update({ status, qr_code: qrCode })
                .eq('id', this.accountId);
        } catch (e: any) {
            logger.warn(`[WhatsAppClient:${this.accountId}] No se pudo persistir estado '${status}': ${e?.message ?? e}`);
        }
    }

    public async start() {
        const AUTH_DIR = this.authDirPath;

        // Guard: do not restart if session clearing failed (prevents infinite loop)
        if (this.sessionClearFailed) {
            console.error('🚨 [CRITICAL] Cannot start: session directory could not be cleared. Manual intervention required.');
            console.error(`🚨 Please manually delete the folder: ${AUTH_DIR}`);
            return;
        }

        if (!fs.existsSync(AUTH_DIR)) fs.mkdirSync(AUTH_DIR, { recursive: true });
        console.log(`📁 [${this.accountId}] Auth dir: ${AUTH_DIR}`);

        const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
        const { version } = await fetchLatestBaileysVersion();

        console.log(`Starting WhatsApp Bot v${version.join('.')} for account ${this.accountId}`);

        this.sock = makeWASocket({
            version,
            auth: state,
            logger: pino({ level: 'silent' }) as any,
            browser: ['Mac OS', 'Chrome', '121.0.6167.159'],
            syncFullHistory: false
        });

        // 🟢 Pairing Code Protocol (Alternative to QR Code)
        if (process.env.PAIRING_PHONE_NUMBER && !this.sock.authState.creds.registered) {
            setTimeout(async () => {
                try {
                    const phone = process.env.PAIRING_PHONE_NUMBER?.replace(/[^0-9]/g, '') || '';
                    console.log(`\n⏳ Solicitando Código de Emparejamiento para ${phone}...`);
                    let code = await this.sock.requestPairingCode(phone);
                    code = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log('\n======================================================');
                    console.log('🔗 CÓDIGO DE VINCULACIÓN DE WHATSAPP: ' + code);
                    console.log('📌 INSTRUCCIONES EN TU CELULAR:');
                    console.log('   1. Abrí WhatsApp > Dispositivos vinculados');
                    console.log('   2. Tocar "Vincular un dispositivo"');
                    console.log('   3. Abajo en la pantalla, tocá "Vincular con el número de teléfono"');
                    console.log('   4. Ingresá el código alfanumérico que ves arriba');
                    console.log('======================================================\n');
                } catch (e: any) {
                    console.error('❌ Error al solicitar código de vinculación:', e.message);
                }
            }, 3000);
        }

        // Fix 1: Periodic cleanup of anti-ban history to prevent memory leaks
        if (!this.cleanupInterval) {
            this.cleanupInterval = setInterval(() => {
                const now = Date.now();
                const TWO_HOURS = 2 * 60 * 60 * 1000;
                let cleaned = 0;
                for (const [jid, history] of this.userSendHistory.entries()) {
                    if (now - history.firstMessageAt > TWO_HOURS) {
                        this.userSendHistory.delete(jid);
                        cleaned++;
                    }
                }
                if (cleaned > 0) {
                    console.log(`🧹 [Anti-Ban Cleanup] Removed ${cleaned} stale entries. Active: ${this.userSendHistory.size}`);
                }
            }, 60 * 60 * 1000); // Run every 1 hour
        }

        this.sock.ev.on('creds.update', saveCreds);

        this.sock.ev.on('connection.update', async (update: any) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                this.qrCodeData = await qrcode.toDataURL(qr);
                this.status = 'SCAN_QR_CODE';
                await this.persistAccountStatus('qr', this.qrCodeData);

                if (!process.env.PAIRING_PHONE_NUMBER) {
                    console.log('📱 QR Code generated. Scan it below:');
                    qrcode.toString(qr, { type: 'terminal', small: true }, (err: Error | null | undefined, url: string) => {
                        if (err) console.error(err);
                        else console.log(url);
                    });
                }
            }

            if (connection === 'close') {
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const errorMessage = lastDisconnect?.error?.message || 'unknown error';
                console.log(`⚠️ [${this.accountId}] Connection closed. Code: ${statusCode}, Error: ${errorMessage}`);

                this.status = 'STOPPED';
                await this.persistAccountStatus('disconnected', null);

                // Handle specific disconnect reasons
                if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
                    console.error('❌ Logged out from WhatsApp. Session is invalid.');
                    this.clearSession(); // Remove corrupt/invalid session

                    if (process.env.PAIRING_PHONE_NUMBER) {
                        console.log('⏳ Esperando 10 segundos antes de solicitar un nuevo código (Para evitar bloqueos de WhatsApp)...');
                        setTimeout(() => this.start(), 10000);
                    } else {
                        console.log('🔄 Restarting to request new QR code...');
                        this.start(); // Auto-restart to generate new QR
                    }
                } else if (statusCode === DisconnectReason.restartRequired) {
                    console.log('🔄 Restart required. Reconnecting immediately...');
                    this.start();
                } else if (statusCode === DisconnectReason.connectionReplaced) {
                    console.error('❌ Connection replaced (opened in another tab/device). Stopping.');
                    // Do not auto-reconnect if replaced, unless explicitly commanded
                } else if (statusCode === DisconnectReason.badSession) {
                    console.error('❌ Bad session file. Deleting session and requesting new scan.');
                    this.clearSession();
                    this.start();
                } else if (statusCode === DisconnectReason.connectionClosed || statusCode === DisconnectReason.connectionLost || statusCode === DisconnectReason.timedOut) {
                    this.reconnectAttempts++;
                    console.log(`⚠️ Connection lost/timed out. Attempt: ${this.reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
                    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        // Exponential backoff: 3s, 6s, 12s, 24s... Max 30s
                        const delay = Math.min(Math.pow(2, this.reconnectAttempts) * 1500, 30000);
                        console.log(`⏳ Reconnecting in ${delay/1000}s...`);
                        setTimeout(() => this.start(), delay);
                    } else {
                        console.error('🚨 Max reconnection attempts reached. Manual intervention required.');
                    }
                } else {
                    // Unknown reason, attempt normal reconnect with backoff
                    this.reconnectAttempts++;
                    if (this.reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
                        setTimeout(() => this.start(), 5000);
                    }
                }
            } else if (connection === 'open') {
                console.log(`✅ [${this.accountId}] Connected to WhatsApp!`);
                this.status = 'WORKING';
                this.qrCodeData = null;
                this.reconnectAttempts = 0; // Reset on successful connection
                await this.persistAccountStatus('connected', null);

                // Sync phone number (genérico/seguro: stub que solo registra)
                const botJid = this.sock?.user?.id;
                if (botJid) {
                    const rawNumber = botJid.split(':')[0].split('@')[0];
                    ConfigurationService.syncBotPhoneNumber(rawNumber).catch(console.error);
                }
            }
        });

        // Event: Message Upsert
        this.sock.ev.on('messages.upsert', async ({ messages, type }: any) => {
            if (type !== 'notify') return;

            const PID = process.pid;
            for (const msg of messages) {
                if (!msg.message) continue;
                if (msg.key.fromMe) continue;
                if (msg.key.remoteJid === 'status@broadcast') continue;

                const remoteJid = msg.key.remoteJid || '';
                // Use centralized normalization
                const phone = PhoneUtils.normalize(remoteJid);
                const pushName = msg.pushName || 'Usuario';

                let text = '';
                let fileContext: any = null;

                if (msg.message.conversation) text = msg.message.conversation;
                else if (msg.message.extendedTextMessage) text = msg.message.extendedTextMessage.text;

                if (msg.message.locationMessage) {
                    console.log(`[Location] Receiving GPS Pin from ${phone}...`);
                    fileContext = {
                        _location: {
                            lat: msg.message.locationMessage.degreesLatitude,
                            lng: msg.message.locationMessage.degreesLongitude
                        }
                    };
                    text = '_LOCATION_RECEIVED_';
                }

                if (msg.message.imageMessage || msg.message.documentMessage || msg.message.audioMessage) {
                    console.log(`[Media] Receiving media from ${phone}...`);
                    try {
                        const buffer = await downloadMediaMessage(msg, 'buffer', { });
                        const audioMsg = msg.message.audioMessage;
                        const mimeType = msg.message.imageMessage ? msg.message.imageMessage.mimetype :
                                       (msg.message.documentMessage ? msg.message.documentMessage.mimetype :
                                       (audioMsg ? audioMsg.mimetype || 'audio/ogg' : ''));

                        const publicUrl = await storageService.uploadMedia(phone, buffer as Buffer, mimeType);
                        if (publicUrl) {
                            fileContext = {
                                _isAudio: !!audioMsg,
                                _receivedFile: { url: publicUrl, mimeType: mimeType, size: (buffer as Buffer).length }
                            };

                            if (audioMsg) {
                                text = '_AUDIO_RECEIVED_';
                                console.log(`[Audio] Audio received from ${phone}, uploaded to: ${publicUrl}`);
                            } else {
                                text = msg.message.imageMessage?.caption || msg.message.documentMessage?.caption || '_MEDIA_RECEIVED_';
                            }
                        }
                    } catch (err) {
                        console.error('[Media] Error processing media:', err);
                    }
                }

                if (!text && !fileContext) continue;

                console.log(`📩 [${this.accountId}] Message from ${pushName} (${phone}): ${text}`);

                try {
                    // Save inbound message (etiquetado por cuenta)
                    await this.store.record({
                        accountId: this.accountId,
                        phone,
                        direction: 'INBOUND',
                        content: text,
                        contactName: pushName,
                    });

                    console.log(`[PID:${PID}] Routing message from ${phone}...`);
                    const responses = await this.onMessage(this.accountId, phone, text, pushName, fileContext || {});
                    console.log(`[PID:${PID}] Got ${(responses || []).length} responses for ${phone}`);

                    for (const response of (responses || [])) {
                        await this.sendFormattedMessage(remoteJid, response);
                    }
                } catch (err) {
                    console.error(`[PID:${PID}] Processing Error:`, err);
                }
            }
        });
    }

    /** Detiene el cliente: cierra el socket y limpia el intervalo de anti-ban. */
    public async stop() {
        try {
            this.status = 'STOPPED';
            if (this.cleanupInterval) {
                clearInterval(this.cleanupInterval);
                this.cleanupInterval = null;
            }
            if (this.sock) {
                this.sock.ev.removeAllListeners('connection.update');
                this.sock.ws?.close();
                this.sock.end(undefined);
                this.sock = null;
            }
            await this.persistAccountStatus('disconnected', null);
        } catch (error: any) {
            console.error(`[WhatsAppClient:${this.accountId}] Error during stop:`, error);
        }
    }

    private async simulateTyping(to: string, textLength: number) {
        if (!this.sock) return;
        try {
            await this.sock.presenceSubscribe(to);
            await new Promise(resolve => setTimeout(resolve, 500));
            await this.sock.sendPresenceUpdate('composing', to);

            const calcDelay = Math.min(Math.max(textLength * 50, MIN_TYPING_DELAY), MAX_TYPING_DELAY);
            await new Promise(resolve => setTimeout(resolve, calcDelay));

            await this.sock.sendPresenceUpdate('paused', to);
            await new Promise(resolve => setTimeout(resolve, 200));
        } catch (error) {
            console.error('Failed to simulate typing:', error);
        }
    }

    public async sendFormattedMessage(jid: string, response: any) {
        if (!this.sock) return;

        // Ensure JID is formatted correctly for Baileys
        const finalJid = jid.includes('@') ? jid : `${jid}@s.whatsapp.net`;

        // Bot loop detection
        const now = Date.now();
        const history = this.userSendHistory.get(finalJid) || { count: 0, firstMessageAt: now };

        if (now - history.firstMessageAt > BOT_LOOP_WINDOW_MS) {
            history.count = 1;
            history.firstMessageAt = now;
        } else {
            history.count++;
            if (history.count > BOT_LOOP_THRESHOLD) {
                console.warn(`[Anti-Ban] Bot loop detected for ${finalJid}. Dropping outbound message.`);
                return;
            }
        }
        this.userSendHistory.set(finalJid, history);

        await this.sendMutex.runExclusive(async () => {
            try {
                if (!response) {
                    console.warn(`[WhatsAppClient] Dropping empty/undefined message to ${finalJid}`);
                    return;
                }

                let sentMsg: any = null;
                let textToSave = '';
                let msgType: 'text'|'poll'|'image'|'document' = 'text';

                // Typing Indicator
                let textLength = 0;
                if (typeof response === 'string') textLength = response.length;
                else if (response.text) textLength = response.text.length;
                else if (response.message) textLength = response.message.length;

                if (textLength > 0) {
                    await this.simulateTyping(finalJid, textLength);
                }

                if (typeof response === 'string') {
                    sentMsg = await this.sock.sendMessage(finalJid, { text: response });
                    textToSave = response;
                } else if (typeof response === 'object' && response !== null) {
                    if (response.poll) {
                        sentMsg = await this.sock.sendMessage(finalJid, { poll: response.poll });
                        textToSave = `[Encuesta: ${response.poll.name}]`;
                        msgType = 'poll';
                    } else if (response.text) {
                        sentMsg = await this.sock.sendMessage(finalJid, { text: response.text });
                        textToSave = response.text;
                    } else if (response.document) {
                        sentMsg = await this.sock.sendMessage(finalJid, {
                            document: response.document,
                            mimetype: response.mimetype || 'application/pdf',
                            fileName: response.fileName || 'document.pdf',
                            caption: response.caption
                        });
                        textToSave = `[Documento: ${response.fileName || 'archivo'}]`;
                        msgType = 'document';
                    } else if (response.image) {
                        sentMsg = await this.sock.sendMessage(finalJid, {
                            image: response.image,
                            caption: response.caption
                        });
                        textToSave = response.caption || '[Imagen]';
                        msgType = 'image';
                    } else if (response.message) {
                        sentMsg = await this.sock.sendMessage(finalJid, { text: response.message });
                        textToSave = response.message;
                    }
                }

                if (sentMsg && textToSave) {
                    await this.store.record({
                        accountId: this.accountId,
                        phone: PhoneUtils.normalize(finalJid),
                        direction: 'OUTBOUND',
                        content: textToSave,
                        messageType: msgType,
                        waMessageId: sentMsg.key?.id ?? undefined,
                    });
                }

                // Pause before next message (Anti-ban queue logic)
                const sendDelayMs = Math.floor(Math.random() * (MAX_SEND_DELAY - MIN_SEND_DELAY + 1) + MIN_SEND_DELAY);
                await new Promise(resolve => setTimeout(resolve, sendDelayMs));

            } catch (error) {
                console.error(`Error sending message to ${jid}:`, error);
            }
        });
    }

    private async clearSession() {
        const AUTH_DIR = this.authDirPath;
        console.log(`🗑️ Clearing session at ${AUTH_DIR}`);

        try {
            if (fs.existsSync(AUTH_DIR)) {
                // Delete using async promises instead of sync, which prevents event loop blocking
                await fs.promises.rm(AUTH_DIR, { recursive: true, force: true });
                console.log('✅ Session directory cleared successfully.');
            }
        } catch (err: any) {
            console.error(`❌ Failed to clear session: ${err.message}`);
            // If it fails (usually due to Windows file locks or similar), we rename it instead
            try {
               const backupDir = `${AUTH_DIR}_backup_${Date.now()}`;
               await fs.promises.rename(AUTH_DIR, backupDir);
               console.log(`✅ Session directory renamed to bypass lock: ${backupDir}`);
            } catch (renameErr: any) {
               console.error(`🚨 [CRITICAL] Could not clear or rename session directory. Manual intervention may be needed: ${renameErr.message}`);
               this.sessionClearFailed = true;
            }
        }

        this.status = 'STOPPED';
        this.sock = null;
        this.qrCodeData = null;
    }

    public async logout() {
        console.log('🚪 Manual logout triggered. Closing connection and clearing session.');
        try {
            this.status = 'STOPPED';
            if (this.sock) {
                // Remove listeners to prevent reconnection loops during logout
                this.sock.ev.removeAllListeners('connection.update');
                this.sock.ws?.close();
                this.sock.end(undefined);
                this.sock = null;
            }

            // Wait slightly to ensure socket releases file locks
            await new Promise(resolve => setTimeout(resolve, 1000));
            await this.clearSession();
            await this.persistAccountStatus('disconnected', null);

            return { success: true, message: 'Bot logged out successfully' };
        } catch (error: any) {
            console.error('Error during logout:', error);
            return { success: false, message: error.message };
        }
    }
}

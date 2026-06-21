import winston from 'winston';
import path from 'path';

const LOG_DIR = path.join(__dirname, '../../../logs');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_FILES = 7; // Keep last 7 rotated files

// --- Masking de secretos ---------------------------------------------------
// Evita filtrar tokens/keys a los logs (consola y archivos). Redacta por:
//  - patrón de valor: JWT (eyJ...), Bearer, claves OpenAI (sk-...).
//  - nombre de campo en metadata: access_token, app_secret, api_key, etc.
const SECRET_FIELD_RE = /(access[_-]?token|app[_-]?secret|verify[_-]?token|service[_-]?key|api[_-]?key|ai_api_key|authorization|password|secret|token)/i;
const REDACTED = '***REDACTED***';

export function redactString(s: string): string {
  return s
    .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, REDACTED) // JWT
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, `Bearer ${REDACTED}`)             // Bearer xxx
    .replace(/sk-[A-Za-z0-9_-]{10,}/g, REDACTED);                            // OpenAI sk-...
}

export function redactDeep(value: any, depth = 0): any {
  if (depth > 6 || value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = SECRET_FIELD_RE.test(k) ? REDACTED : redactDeep(v, depth + 1);
    }
    return out;
  }
  return value;
}

// Format de winston que redacta message + metadata antes de cualquier transport.
const redactFormat = winston.format((info) => {
  if (typeof info.message === 'string') info.message = redactString(info.message);
  for (const k of Object.keys(info)) {
    if (k === 'level' || k === 'message' || k === 'timestamp') continue;
    (info as any)[k] = SECRET_FIELD_RE.test(k) ? REDACTED : redactDeep((info as any)[k]);
  }
  return info;
})();

const logFormat = winston.format.printf((info) => {
    const { level, message, timestamp, ...metadata } = info;

    let msg = `${timestamp} [${level}] : ${message} `;

    const cleanMeta = { ...metadata };
    delete cleanMeta.timestamp;
    delete cleanMeta.level;
    delete cleanMeta.message;
    delete cleanMeta.metadata;

    if (Object.keys(cleanMeta).length > 0) {
        const getCircularReplacer = () => {
          const seen = new WeakSet();
          return (key: string, value: any) => {
            if (typeof value === "object" && value !== null) {
              if (seen.has(value)) {
                return "[Circular]";
              }
              seen.add(value);
            }
            return value;
          };
        };
        msg += JSON.stringify(cleanMeta, getCircularReplacer());
    }
    return msg;
});

// JSON format for production file logs (easy to parse/search)
const jsonFormat = winston.format.combine(
    redactFormat,
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
);

// Colorized format for console
const consoleFormat = winston.format.combine(
    redactFormat,
    winston.format.timestamp({ format: 'HH:mm:ss' }),
    winston.format.colorize(),
    logFormat
);

export const logger = winston.createLogger({
    level: process.env.LOG_LEVEL || 'info',
    transports: [
        // Console: colorized, readable
        new winston.transports.Console({
            format: consoleFormat
        }),
        // Error log: only errors, rotated
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'error.log'),
            level: 'error',
            format: jsonFormat,
            maxsize: MAX_FILE_SIZE,
            maxFiles: MAX_FILES,
            tailable: true
        }),
        // Combined log: all levels, rotated
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'app.log'),
            format: jsonFormat,
            maxsize: MAX_FILE_SIZE,
            maxFiles: MAX_FILES,
            tailable: true
        }),
        // Bot-specific log: WhatsApp events
        new winston.transports.File({
            filename: path.join(LOG_DIR, 'bot.log'),
            format: jsonFormat,
            maxsize: MAX_FILE_SIZE,
            maxFiles: MAX_FILES,
            tailable: true
        })
    ]
});

/**
 * Bot-specific logger that tags all messages with [BOT] prefix
 * and writes to the dedicated bot.log file.
 */
export const botLogger = {
    info: (msg: string, meta?: Record<string, unknown>) => logger.info(`[BOT] ${msg}`, meta),
    warn: (msg: string, meta?: Record<string, unknown>) => logger.warn(`[BOT] ${msg}`, meta),
    error: (msg: string, meta?: Record<string, unknown>) => logger.error(`[BOT] ${msg}`, meta),
    debug: (msg: string, meta?: Record<string, unknown>) => logger.debug(`[BOT] ${msg}`, meta),
};

export default logger;

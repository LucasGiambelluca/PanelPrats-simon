import winston from 'winston';
import path from 'path';

const LOG_DIR = path.join(__dirname, '../../../logs');
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
const MAX_FILES = 7; // Keep last 7 rotated files

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
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
);

// Colorized format for console
const consoleFormat = winston.format.combine(
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

import * as fs from 'fs';
import * as path from 'path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogContext {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: any;
}

export class Logger {
  private minLevel: LogLevel;
  private enabled: boolean;
  private logDir: string;

  constructor(options: { minLevel?: LogLevel; enabled?: boolean; logDir?: string } = {}) {
    this.minLevel = options.minLevel ?? 'info';
    this.enabled = options.enabled ?? true;
    this.logDir = options.logDir ?? './logs';

    // Create logs directory if it doesn't exist
    if (!fs.existsSync(this.logDir)) {
      fs.mkdirSync(this.logDir, { recursive: true });
    }
  }

  private levelToNumber(level: LogLevel): number {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
    return levels[level];
  }

  private isLevelEnabled(level: LogLevel): boolean {
    return this.enabled &&
           this.levelToNumber(level) >= this.levelToNumber(this.minLevel);
  }

  private formatTimestampForFile(): string {
    return new Date().toISOString();
  }

  private formatTimestampForConsole(): string {
    const now = new Date();
    return now.toLocaleTimeString('fr-FR', { hour12: false }); // HH:MM:SS format
  }

  private formatLevelForConsole(level: LogLevel): string {
    return level.toUpperCase().padEnd(5, ' ');
  }

  private createBaseLog(level: LogLevel, message: string): LogContext {
    return {
      timestamp: this.formatTimestampForFile(),
      level,
      message
    };
  }

  private writeToLogFile(level: LogLevel, logEntry: LogContext): void {
    if (!this.enabled) return;

    const logFileName = `${this.logDir}/${level}.log`;
    const logLine = JSON.stringify(logEntry) + '\n';
    fs.appendFileSync(logFileName, logLine, 'utf8');
  }

  private outputToConsole(level: LogLevel, message: string, meta: Record<string, any> = {}): void {
    if (!this.enabled) return;

    const timestamp = this.formatTimestampForConsole();
    const levelStr = this.formatLevelForConsole(level);
    let logMessage = `[${levelStr.trim()}] ${timestamp} ${message}`;

    // Add meta information if present
    if (meta && Object.keys(meta).length > 0) {
      const metaStr = Object.entries(meta)
        .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
        .join(' ');
      logMessage += ` ${metaStr}`;
    }

    // Call the appropriate console method based on level
    switch (level) {
      case 'debug':
      case 'info':
        console.log(logMessage);
        break;
      case 'warn':
        console.warn(logMessage);
        break;
      case 'error':
        console.error(logMessage);
        break;
    }
  }

  debug(message: string, meta: Record<string, any> = {}): void {
    if (!this.isLevelEnabled('debug')) return;
    const logEntry = { ...this.createBaseLog('debug', message), ...meta };
    this.writeToLogFile('debug', logEntry);
    this.outputToConsole('debug', message, meta);
  }

  info(message: string, meta: Record<string, any> = {}): void {
    if (!this.isLevelEnabled('info')) return;
    const logEntry = { ...this.createBaseLog('info', message), ...meta };
    this.writeToLogFile('info', logEntry);
    this.outputToConsole('info', message, meta);
  }

  warn(message: string, meta: Record<string, any> = {}): void {
    if (!this.isLevelEnabled('warn')) return;
    const logEntry = { ...this.createBaseLog('warn', message), ...meta };
    this.writeToLogFile('warn', logEntry);
    this.outputToConsole('warn', message, meta);
  }

  error(message: string, meta: Record<string, any> = {}): void {
    if (!this.isLevelEnabled('error')) return;
    const logEntry = { ...this.createBaseLog('error', message), ...meta };
    this.writeToLogFile('error', logEntry);
    this.outputToConsole('error', message, meta);
  }

  // Specialized loggers as mentioned in the spec
  request(message: string, meta: Record<string, any> = {}): void {
    this.info(message, { context: 'REQUEST', ...meta });
  }

  errorLog(message: string, meta: Record<string, any> = {}): void {
    this.error(message, { context: 'ERROR', ...meta });
  }

  keyManagement(message: string, meta: Record<string, any> = {}): void {
    this.info(message, { context: 'KEY_MANAGEMENT', ...meta });
  }

  sse(message: string, meta: Record<string, any> = {}): void {
    this.debug(message, { context: 'SSE', ...meta });
  }

  proxy(message: string, meta: Record<string, any> = {}): void {
    this.debug(message, { context: 'PROXY', ...meta });
  }

  ws(message: string, meta: Record<string, any> = {}): void {
    this.debug(message, { context: 'WS', ...meta });
  }
}

// Default logger instance with logs directory
export const logger = new Logger({ logDir: './logs' });
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

  constructor(options: { minLevel?: LogLevel; enabled?: boolean } = {}) {
    this.minLevel = options.minLevel ?? 'info';
    this.enabled = options.enabled ?? true;
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

  private formatTimestamp(): string {
    return new Date().toISOString();
  }

  private createBaseLog(level: LogLevel, message: string): LogContext {
    return {
      timestamp: this.formatTimestamp(),
      level,
      message
    };
  }

  debug(message: string, meta: Record<string, any> = {}): void {
    if (!this.isLevelEnabled('debug')) return;
    const logEntry = { ...this.createBaseLog('debug', message), ...meta };
    console.log(JSON.stringify(logEntry));
  }

  info(message: string, meta: Record<string, any> = {}): void {
    if (!this.isLevelEnabled('info')) return;
    const logEntry = { ...this.createBaseLog('info', message), ...meta };
    console.log(JSON.stringify(logEntry));
  }

  warn(message: string, meta: Record<string, any> = {}): void {
    if (!this.isLevelEnabled('warn')) return;
    const logEntry = { ...this.createBaseLog('warn', message), ...meta };
    console.warn(JSON.stringify(logEntry));
  }

  error(message: string, meta: Record<string, any> = {}): void {
    if (!this.isLevelEnabled('error')) return;
    const logEntry = { ...this.createBaseLog('error', message), ...meta };
    console.error(JSON.stringify(logEntry));
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

// Default logger instance
export const logger = new Logger();
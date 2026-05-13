import { Logger, LogLevel } from '../src/logger';

describe('Logger', () => {
  let logger: Logger;
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new Logger({ minLevel: 'info', enabled: true });
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  it('should log debug messages when minLevel is debug', () => {
    const debugLogger = new Logger({ minLevel: 'debug', enabled: true });
    debugLogger.debug('test debug message', { test: 'value' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"debug"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"test debug message"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"test":"value"')
    );
  });

  it('should not log debug messages when minLevel is info', () => {
    logger.debug('test debug message');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should log info messages when minLevel is info', () => {
    logger.info('test info message', { test: 'value' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"info"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"test info message"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"test":"value"')
    );
  });

  it('should not log info messages when minLevel is warn', () => {
    const warnLogger = new Logger({ minLevel: 'warn', enabled: true });
    warnLogger.info('test info message');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should log warn messages when minLevel is warn', () => {
    logger.warn('test warn message', { test: 'value' });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"warn"')
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"test warn message"')
    );
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"test":"value"')
    );
  });

  it('should not log warn messages when minLevel is error', () => {
    const errorLogger = new Logger({ minLevel: 'error', enabled: true });
    errorLogger.warn('test warn message');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should log error messages when minLevel is error', () => {
    logger.error('test error message', { test: 'value' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"level":"error"')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"test error message"')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"test":"value"')
    );
  });

  it('should not log anything when disabled', () => {
    const disabledLogger = new Logger({ enabled: false });
    disabledLogger.debug('test');
    disabledLogger.info('test');
    disabledLogger.warn('test');
    disabledLogger.error('test');
    expect(consoleLogSpy).not.toHaveBeenCalled();
    expect(consoleWarnSpy).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it('should include timestamp in log entries', () => {
    logger.info('test message');
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\"timestamp\":\".+\"/)
    );
  });

  it('should have specialized request logger', () => {
    logger.request('test request', { method: 'GET' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"context":"REQUEST"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"test request"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"method":"GET"')
    );
  });

  it('should have specialized error logger', () => {
    logger.errorLog('test error', { code: 500 });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"context":"ERROR"')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"test error"')
    );
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining('"code":500')
    );
  });

  it('should have specialized key management logger', () => {
    logger.keyManagement('test key event', { key: 'key123' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"context":"KEY_MANAGEMENT"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"test key event"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"key":"key123"')
    );
  });

  it('should have specialized SSE logger', () => {
    // Create a logger with debug level enabled to capture SSE logs
    const debugLogger = new Logger({ minLevel: 'debug', enabled: true });
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    debugLogger.sse('test sse event', { eventType: 'message' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"context":"SSE"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"test sse event"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"eventType":"message"')
    );
    consoleLogSpy.mockRestore();
  });

  it('should have specialized proxy logger', () => {
    // Create a logger with debug level enabled to capture proxy logs
    const debugLogger = new Logger({ minLevel: 'debug', enabled: true });
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    debugLogger.proxy('test proxy event', { step: 'header processing' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"context":"PROXY"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"test proxy event"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"step":"header processing"')
    );
    consoleLogSpy.mockRestore();
  });

  it('should have specialized WebSocket logger', () => {
    // Create a logger with debug level enabled to capture WS logs
    const debugLogger = new Logger({ minLevel: 'debug', enabled: true });
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    debugLogger.ws('test ws event', { action: 'upgrade' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"context":"WS"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"message":"test ws event"')
    );
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining('"action":"upgrade"')
    );
    consoleLogSpy.mockRestore();
  });
});
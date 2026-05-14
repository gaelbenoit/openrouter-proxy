import { Logger, LogLevel } from '../src/logger';
import * as fs from 'fs';
import * as path from 'path';

describe('Logger', () => {
  let logger: Logger;
  let consoleLogSpy: jest.SpyInstance;
  let consoleWarnSpy: jest.SpyInstance;
  let consoleErrorSpy: jest.SpyInstance;
  const testLogDir = './test-logs';

  beforeEach(() => {
    // Clean up test log directory
    if (fs.existsSync(testLogDir)) {
      fs.rmdirSync(testLogDir, { recursive: true });
    }

    logger = new Logger({ minLevel: 'info', enabled: true, logDir: testLogDir });
    consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    consoleLogSpy.mockRestore();
    consoleWarnSpy.mockRestore();
    consoleErrorSpy.mockRestore();

    // Clean up test log directory after tests
    if (fs.existsSync(testLogDir)) {
      fs.rmdirSync(testLogDir, { recursive: true });
    }
  });

  it('should log debug messages when minLevel is debug', () => {
    const debugLogger = new Logger({ minLevel: 'debug', enabled: true, logDir: testLogDir });
    debugLogger.debug('test debug message', { test: 'value' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[DEBUG\] \d{2}:\d{2}:\d{2} test debug message test: "value"/)
    );

    // Check that log file was created and contains the expected JSON
    const logFilePath = path.join(testLogDir, 'debug.log');
    expect(fs.existsSync(logFilePath)).toBe(true);
    const logContent = fs.readFileSync(logFilePath, 'utf8');
    expect(logContent).toContain('"level":"debug"');
    expect(logContent).toContain('"message":"test debug message"');
    expect(logContent).toContain('"test":"value"');
  });

  it('should not log debug messages when minLevel is info', () => {
    logger.debug('test debug message');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should log info messages when minLevel is info', () => {
    logger.info('test info message', { test: 'value' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[INFO\] \d{2}:\d{2}:\d{2} test info message test: "value"/)
    );

    // Check that log file was created and contains the expected JSON
    const logFilePath = path.join(testLogDir, 'info.log');
    expect(fs.existsSync(logFilePath)).toBe(true);
    const logContent = fs.readFileSync(logFilePath, 'utf8');
    expect(logContent).toContain('"level":"info"');
    expect(logContent).toContain('"message":"test info message"');
    expect(logContent).toContain('"test":"value"');
  });

  it('should not log info messages when minLevel is warn', () => {
    const warnLogger = new Logger({ minLevel: 'warn', enabled: true, logDir: testLogDir });
    warnLogger.info('test info message');
    expect(consoleLogSpy).not.toHaveBeenCalled();
  });

  it('should log warn messages when minLevel is warn', () => {
    logger.warn('test warn message', { test: 'value' });
    expect(consoleWarnSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[WARN\] \d{2}:\d{2}:\d{2} test warn message test: "value"/)
    );

    // Check that log file was created and contains the expected JSON
    const logFilePath = path.join(testLogDir, 'warn.log');
    expect(fs.existsSync(logFilePath)).toBe(true);
    const logContent = fs.readFileSync(logFilePath, 'utf8');
    expect(logContent).toContain('"level":"warn"');
    expect(logContent).toContain('"message":"test warn message"');
    expect(logContent).toContain('"test":"value"');
  });

  it('should not log warn messages when minLevel is error', () => {
    const errorLogger = new Logger({ minLevel: 'error', enabled: true, logDir: testLogDir });
    errorLogger.warn('test warn message');
    expect(consoleWarnSpy).not.toHaveBeenCalled();
  });

  it('should log error messages when minLevel is error', () => {
    logger.error('test error message', { test: 'value' });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[ERROR\] \d{2}:\d{2}:\d{2} test error message test: "value"/)
    );

    // Check that log file was created and contains the expected JSON
    const logFilePath = path.join(testLogDir, 'error.log');
    expect(fs.existsSync(logFilePath)).toBe(true);
    const logContent = fs.readFileSync(logFilePath, 'utf8');
    expect(logContent).toContain('"level":"error"');
    expect(logContent).toContain('"message":"test error message"');
    expect(logContent).toContain('"test":"value"');
  });

  it('should not log anything when disabled', () => {
    const disabledLogger = new Logger({ enabled: false, logDir: testLogDir });
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
      expect.stringMatching(/\[INFO\] \d{2}:\d{2}:\d{2} test message/)
    );
  });

  it('should have specialized request logger', () => {
    logger.request('test request', { method: 'GET' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[INFO\] \d{2}:\d{2}:\d{2} test request context: "REQUEST" method: "GET"/)
    );
  });

  it('should have specialized error logger', () => {
    logger.errorLog('test error', { code: 500 });
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[ERROR\] \d{2}:\d{2}:\d{2} test error context: "ERROR" code: 500/)
    );
  });

  it('should have specialized key management logger', () => {
    logger.keyManagement('test key event', { key: 'key123' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[INFO\] \d{2}:\d{2}:\d{2} test key event context: "KEY_MANAGEMENT" key: "key123"/)
    );
  });

  it('should have specialized SSE logger', () => {
    // Create a logger with debug level enabled to capture SSE logs
    const debugLogger = new Logger({ minLevel: 'debug', enabled: true, logDir: testLogDir });
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    debugLogger.sse('test sse event', { eventType: 'message' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[DEBUG\] \d{2}:\d{2}:\d{2} test sse event context: "SSE" eventType: "message"/)
    );
    consoleLogSpy.mockRestore();

    // Check that SSE log file was created
    const logFilePath = path.join(testLogDir, 'debug.log');
    expect(fs.existsSync(logFilePath)).toBe(true);
  });

  it('should have specialized proxy logger', () => {
    // Create a logger with debug level enabled to capture proxy logs
    const debugLogger = new Logger({ minLevel: 'debug', enabled: true, logDir: testLogDir });
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    debugLogger.proxy('test proxy event', { step: 'header processing' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[DEBUG\] \d{2}:\d{2}:\d{2} test proxy event context: "PROXY" step: "header processing"/)
    );
    consoleLogSpy.mockRestore();
  });

  it('should have specialized WebSocket logger', () => {
    // Create a logger with debug level enabled to capture WS logs
    const debugLogger = new Logger({ minLevel: 'debug', enabled: true, logDir: testLogDir });
    const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();
    debugLogger.ws('test ws event', { action: 'upgrade' });
    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringMatching(/\[DEBUG\] \d{2}:\d{2}:\d{2} test ws event context: "WS" action: "upgrade"/)
    );
    consoleLogSpy.mockRestore();
  });
});
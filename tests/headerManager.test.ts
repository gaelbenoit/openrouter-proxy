import { HeaderManager } from '../src/headerManager';
import { ProxyConfig } from '../src/types';

describe('HeaderManager', () => {
  let headerManager: HeaderManager;
  let config: ProxyConfig;

  beforeEach(() => {
    config = {
      host: '127.0.0.1',
      port: 8899,
      targetHost: 'openrouter.ai',
      targetPort: 443,
      targetProtocol: 'https',
      apiKeys: ['test-api-key-1', 'test-api-key-2'],
      httpReferer: 'https://github.com/openrouter',
      openRouterTitle: 'OpenRouter Proxy',
      verboseLogging: false,
      keyFailureThreshold: 3
    };

    headerManager = new HeaderManager(config);
  });

  it('should strip hop-by-hop headers from request', () => {
    const incomingHeaders = {
      'host': 'localhost:8899',
      'connection': 'keep-alive',
      'proxy-authorization': 'Bearer token',
      'te': 'trailers',
      'transfer-encoding': 'chunked',
      'upgrade': 'websocket',
      'content-type': 'application/json',
      'authorization': 'Bearer client-token'
    };

    const clientIp = '192.168.1.100';
    const originalHost = 'localhost:8899';

    const result = headerManager.processRequestHeaders(
      incomingHeaders,
      clientIp,
      originalHost
    );

    // Hop-by-hop headers should be removed
    expect(result.connection).toBeUndefined();
    expect(result['proxy-authorization']).toBeUndefined();
    expect(result.te).toBeUndefined();
    expect(result['transfer-encoding']).toBeUndefined();
    expect(result.upgrade).toBeUndefined();

    // Specific client headers should be removed (then reconstructed)
    // So we expect the reconstructed host value
    expect(result.host).toBe('openrouter.ai:443'); // Reconstructed host

    // Required headers should be added
    expect(result.authorization).toBe('Bearer test-api-key-1'); // First key from config
    expect(result['http-referer']).toBe('https://github.com/openrouter');
    expect(result['x-openrouter-title']).toBe('OpenRouter Proxy');
    expect(result['x-forwarded-for']).toBe('192.168.1.100'); // Client IP
    expect(result['x-forwarded-host']).toBe('localhost:8899'); // Original host
    expect(result['x-forwarded-proto']).toBe('http');

    // Other headers should be preserved
    expect(result['content-type']).toBe('application/json');
  });

  it('should process SSE response headers correctly', () => {
    const incomingHeaders = {
      'content-type': 'text/event-stream',
      'content-length': '1234',
      'cache-control': 'max-age=3600',
      'connection': 'close'
    };

    const result = headerManager.processResponseHeaders(
      incomingHeaders,
      true, // isSse
      true  // isClaudeCode
    );

    // Hop-by-hop headers should be removed
    expect(result['content-length']).toBeUndefined();
    expect(result['cache-control']).toBe('no-cache, no-transform');
    expect(result.connection).toBe('keep-alive');
    expect(result['x-accel-buffering']).toBe('no');
    expect(result['content-type']).toBe('text/event-stream'); // Preserved
  });

  it('should process regular response headers correctly', () => {
    const incomingHeaders = {
      'content-type': 'application/json',
      'content-length': '456',
      'cache-control': 'max-age=3600'
    };

    const result = headerManager.processResponseHeaders(
      incomingHeaders,
      false, // isSse
      false  // isClaudeCode
    );

    // Hop-by-hop headers should be removed
    expect(result['content-length']).toBeUndefined();
    expect(result['cache-control']).toBeUndefined();
    expect(result['content-type']).toBe('application/json'); // Preserved
  });
});
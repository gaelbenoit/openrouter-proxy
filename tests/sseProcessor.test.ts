import { SSEProcessor } from '../src/sseProcessor';
import { IncomingRequest, ProxyResponse } from '../src/types';

describe('SSEProcessor', () => {
  let processor: SSEProcessor;

  beforeEach(() => {
    processor = new SSEProcessor({
      claudeCodeUserAgents: ['VS Code Claude Code'],
      signatureValue: 'dd9960d18582b741463f3ba1347853ee2ad01144306d9b1e07fd45808d81b171'
    });
  });

  it('should return non-SSE response unchanged', () => {
    const request: IncomingRequest = {
      method: 'GET',
      url: '/v1/models',
      headers: {},
      body: null
    };

    const response: ProxyResponse = {
      statusCode: 200,
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('{"models": []}')
    };

    const result = processor.processSseResponse(response, request);
    expect(result).toEqual(response);
  });

  it('should return SSE response with general headers applied', () => {
    const request: IncomingRequest = {
      method: 'GET',
      url: '/v1/chat/completions',
      headers: {},
      body: null
    };

    const response: ProxyResponse = {
      statusCode: 200,
      headers: {
        'content-type': 'text/event-stream',
        'content-length': '123',
        'cache-control': 'max-age=3600'
      },
      body: Buffer.from('data: test\n\n')
    };

    const result = processor.processSseResponse(response, request);

    // Should not be the same object (headers copied)
    expect(result).not.toBe(response);
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('text/event-stream');
    // Hop-by-hop headers should be removed
    expect(result.headers['content-length']).toBeUndefined();
    expect(result.headers['cache-control']).toBe('no-cache, no-transform');
    // SSE-specific headers should be added
    expect(result.headers['connection']).toBe('keep-alive');
    expect(result.headers['x-accel-buffering']).toBe('no');
    expect(result.body).toEqual(response.body);
  });

  it('should not apply Claude Code specific fixes when not Claude Code request', () => {
    const request: IncomingRequest = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'user-agent': 'some-other-client' },
      body: null
    };

    const response: ProxyResponse = {
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: Buffer.from('data: test\n\n')
    };

    const result = processor.processSseResponse(response, request);
    // Should have general SSE headers but no Claude Code specific processing
    expect(result.headers['connection']).toBe('keep-alive');
    expect(result.headers['x-accel-buffering']).toBe('no');
    // Since we're not implementing the actual stream processing in this simplified version,
    // the body should be unchanged
    expect(result.body).toEqual(response.body);
  });

  it('should apply Claude Code specific fixes when Claude Code request (body unchanged in this simplified impl)', () => {
    const request: IncomingRequest = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'user-agent': 'VS Code Claude Code' },
      body: null
    };

    const response: ProxyResponse = {
      statusCode: 200,
      headers: { 'content-type': 'text/event-stream' },
      body: Buffer.from('data: test\n\n')
    };

    const result = processor.processSseResponse(response, request);
    // Should have general SSE headers
    expect(result.headers['connection']).toBe('keep-alive');
    expect(result.headers['x-accel-buffering']).toBe('no');
    // Body unchanged (since we're not implementing the full stream processing yet)
    expect(result.body).toEqual(response.body);
  });
});
import { RequestBodyProcessor } from '../src/requestBodyProcessor';

describe('RequestBodyProcessor', () => {
  let processor: RequestBodyProcessor;

  beforeEach(() => {
    processor = new RequestBodyProcessor();
  });

  it('should return request unchanged when no body', async () => {
    const request = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: null
    };

    const result = await processor.processRequestBody(request);
    expect(result.method).toBe(request.method);
    expect(result.url).toBe(request.url);
    expect(result.headers).toEqual(request.headers);
    expect(result.body).toBe(request.body);
    expect(result.shouldProcessMixedMessages).toBe(false);
  });

  it('should return request unchanged when empty body', async () => {
    const request = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from('')
    };

    const result = await processor.processRequestBody(request);
    expect(result.method).toBe(request.method);
    expect(result.url).toBe(request.url);
    expect(result.headers).toEqual(request.headers);
    expect(result.body).toEqual(request.body);
    expect(result.shouldProcessMixedMessages).toBe(false);
  });

  it('should return request unchanged when non-JSON body', async () => {
    const request = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'text/plain' },
      body: Buffer.from('plain text body')
    };

    const result = await processor.processRequestBody(request);
    expect(result.method).toBe(request.method);
    expect(result.url).toBe(request.url);
    expect(result.headers).toEqual(request.headers);
    expect(result.body).toEqual(request.body);
    expect(result.shouldProcessMixedMessages).toBe(false);
  });

  it('should return request unchanged when JSON but not messages array', async () => {
    const request = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify({ model: 'gpt-3.5-turbo', max_tokens: 100 }))
    };

    const result = await processor.processRequestBody(request);
    expect(result.method).toBe(request.method);
    expect(result.url).toBe(request.url);
    expect(result.headers).toEqual(request.headers);
    expect(result.body).toEqual(request.body);
    expect(result.shouldProcessMixedMessages).toBe(false);
  });

  it('should process simple messages array without mixed content', async () => {
    const request = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'user', content: 'Hello!' }
      ]))
    };

    const result = await processor.processRequestBody(request);
    expect(result.body).toEqual(request.body); // Should be unchanged
    expect(result.shouldProcessMixedMessages).toBe(false);
  });

  it('should separate tool_result blocks from text blocks', async () => {
    const request = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify([
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Let me help you with that' },
            { type: 'tool_result', tool_use_id: 'tool123', content: 'Result from tool' }
          ]
        },
        { role: 'user', content: 'Thanks!' }
      ]))
    };

    const result = await processor.processRequestBody(request);
    expect(result.shouldProcessMixedMessages).toBe(true);

    // Parse the processed body to verify separation
    const processedMessages = JSON.parse(result.body!.toString('utf8'));

    // Should have 2 messages now (tool_result first, then user message)
    expect(processedMessages.length).toBe(2);

    // First message should contain only the tool_result
    expect(processedMessages[0].role).toBe('assistant');
    expect(Array.isArray(processedMessages[0].content)).toBe(true);
    expect(processedMessages[0].content.length).toBe(1);
    expect(processedMessages[0].content[0].type).toBe('tool_result');

    // Second message should be the user message
    expect(processedMessages[1].role).toBe('user');
    expect(processedMessages[1].content).toBe('Thanks!');
  });

  it('should handle direct tool_result property', async () => {
    const request = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify([
        {
          role: 'assistant',
          tool_result: { tool_use_id: 'tool123', content: 'Tool result' }
        },
        { role: 'user', content: 'Thanks!' }
      ]))
    };

    const result = await processor.processRequestBody(request);
    expect(result.shouldProcessMixedMessages).toBe(true);

    // Parse the processed body to verify separation
    const processedMessages = JSON.parse(result.body!.toString('utf8'));

    // Should have 2 messages now
    expect(processedMessages.length).toBe(2);

    // First message should contain only the tool_result
    expect(processedMessages[0].role).toBe('assistant');
    expect('tool_result' in processedMessages[0]).toBe(true);
    expect(processedMessages[0].tool_result.tool_use_id).toBe('tool123');

    // Second message should be the user message
    expect(processedMessages[1].role).toBe('user');
    expect(processedMessages[1].content).toBe('Thanks!');
  });

  it('should preserve messages without tool_results', async () => {
    const request = {
      method: 'POST',
      url: '/v1/chat/completions',
      headers: { 'content-type': 'application/json' },
      body: Buffer.from(JSON.stringify([
        { role: 'system', content: 'You are a helpful assistant' },
        { role: 'assistant', content: 'I can help you with that' },
        { role: 'user', content: 'Thanks!' }
      ]))
    };

    const result = await processor.processRequestBody(request);
    expect(result.shouldProcessMixedMessages).toBe(false);
    expect(result.body).toEqual(request.body); // Should be unchanged
  });
});
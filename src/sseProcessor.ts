import { IncomingRequest, ProxyResponse } from './types';

export interface SSEProcessorOptions {
  claudeCodeUserAgents: string[]; // User agent strings that identify VS Code Claude Code
  signatureValue: string; // The signature value to inject for thinking block completion
}

export class SSEProcessor {
  private options: SSEProcessorOptions;

  constructor(options: SSEProcessorOptions) {
    this.options = options;
  }

  /**
   * Processes an outgoing SSE response, applying general SSE compatibility fixes
   * and VS Code Claude Code specific fixes when appropriate.
   */
  processSseResponse(
    response: ProxyResponse,
    request: IncomingRequest
  ): ProxyResponse {
    // Create a copy of the response to avoid mutating the original
    const processedResponse: ProxyResponse = {
      statusCode: response.statusCode,
      headers: { ...response.headers },
      body: response.body
    };

    // Check if this is an SSE response
    const isSse = this.isSseResponse(processedResponse);
    if (!isSse) {
      return processedResponse; // Not SSE, return as-is
    }

    // Apply general SSE compatibility headers
    this.applyGeneralSseHeaders(processedResponse);

    // Check if this is from VS Code Claude Code extension
    const isClaudeCode = this.isClaudeCodeRequest(request);
    if (isClaudeCode) {
      // Apply VS Code Claude Code specific fixes to the body
      processedResponse.body = this.processSseStream(
        processedResponse.body,
        request
      );
    }

    return processedResponse;
  }

  /**
   * Checks if a response is an SSE response based on Content-Type header.
   */
  private isSseResponse(response: ProxyResponse): boolean {
    const contentType = response.headers['content-type'] ||
                      response.headers['Content-Type'] ||
                      '';
    return contentType.includes('text/event-stream');
  }

  /**
   * Applies general SSE compatibility headers to the response.
   */
  private applyGeneralSseHeaders(response: ProxyResponse): void {
    // Remove hop-by-hop and potentially conflicting headers
    const headersToRemove = [
      'content-length',
      'content-encoding',
      'cache-control'
    ];

    headersToRemove.forEach(header => {
      delete response.headers[header.toLowerCase()];
      delete response.headers[header];
    });

    // Add appropriate headers for SSE compatibility
    response.headers['cache-control'] = 'no-cache, no-transform';
    response.headers['connection'] = 'keep-alive';
    response.headers['x-accel-buffering'] = 'no';
  }

  /**
   * Checks if the request originates from VS Code Claude Code extension.
   */
  private isClaudeCodeRequest(request: IncomingRequest): boolean {
    const userAgent = request.headers['user-agent'] ||
                     request.headers['User-Agent'] ||
                     '';

    return this.options.claudeCodeUserAgents.some(agent =>
      userAgent.includes(agent)
    );
  }

  /**
   * Processes an SSE stream with VS Code Claude Code specific fixes.
   * This implementation assumes the body is a Buffer (as we collect chunks in server.ts).
   * For other types, we return the body as-is.
   */
  public processSseStream(
    body: Buffer | ReadableStream | undefined,
    request: IncomingRequest
  ): Buffer | ReadableStream | undefined {
    // If no body, return as-is
    if (!body) {
      return body;
    }

    // We only process Buffer bodies for now (since we collect chunks in server.ts)
    if (body instanceof Buffer) {
      const bodyString = body.toString('utf8');
      const processedString = this.processSseString(bodyString);
      return Buffer.from(processedString, 'utf8');
    }

    // For ReadableStream or other types, return as-is (we don't process them)
    return body;
  }

  /**
   * Processes an SSE string with the state machine for VS Code Claude Code specific fixes.
   */
  private processSseString(input: string): string {
    let buffer = '';
    let isThinking = false;
    let isRedactedThinking = false;
    const pendingIndexes: number[] = [];
    const outputLines: string[] = [];

    // Split by newline to process line by line, but we need to handle events separated by double newline
    const lines = input.split('\n');

    for (const line of lines) {
      buffer += line + '\n';

      // Process complete events (separated by double newline)
      while (buffer.endsWith('\n\n')) {
        const eventBlock = buffer.slice(0, -2); // Remove the trailing \n\n
        buffer = ''; // Reset buffer

        const { event, data } = this.parseSSEBlock(eventBlock);

        // Handle redacted_thinking blocks filtering
        if (event === 'content_block_start' && data && typeof data === 'object' && 'type' in data && data.type === 'redacted_thinking') {
          // Start of a redacted thinking block - start filtering
          isRedactedThinking = true;
          // Filter this event (don't forward)
          continue;
        } else if (isRedactedThinking && event === 'content_block_stop') {
          // End of a redacted thinking block - stop filtering after this event
          isRedactedThinking = false;
          // We DO forward the content_block_stop that ends the filter
          outputLines.push(eventBlock);
          continue;
        } else if (isRedactedThinking) {
          // Currently inside a redacted thinking block - filter this event
          continue;
        }

        // Not filtering - process normally for thinking blocks etc.

        // Handle thinking block completion (inject signature_delta when thinking ends)
        if (isThinking && !(data && typeof data === 'object' && 'type' in data && data.type === 'thinking')) {
          // Thinking block just ended - inject signature_delta
          isThinking = false;
          const signatureEvent = `event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"signature_delta","signature":"${this.options.signatureValue}"}}`;
          outputLines.push(signatureEvent);
        }

        if (event === 'content_block_start') {
          if (data && typeof data === 'object' && 'type' in data && data.type === 'thinking') {
            isThinking = true;
          }
          // Flush pending indexes and save the new index
          // First, flush all pending indexes (send them now)
          for (const index of pendingIndexes) {
            outputLines.push(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}`);
          }
          pendingIndexes.length = 0; // Clear pending indexes

          // Then save the index from this content_block_start for future flushing
          if (data && typeof data === 'object' && 'index' in data) {
            pendingIndexes.push(data.index);
          }

          // Forward the content_block_start event
          outputLines.push(eventBlock);
        } else if (event === 'content_block_stop') {
          // Do NOT forward content_block_stop events here - they will be flushed on the next content_block_start or at the end
          // Just record that we've seen a stop (but we don't need to do anything with pendingIndexes for stop events)
          // Actually, we don't need to do anything special here - the pendingIndexes array holds the indexes of started blocks
          // that are waiting for their stop events to be flushed.
          // We don't add anything to pendingIndexes for a stop event.
          // We'll just not forward it (it will be handled by the flushing logic above)
        } else {
          // All other events (including message_stop, [DONE], etc.): forward normally
          outputLines.push(eventBlock);
        }
      }
    }

    // Handle any remaining buffer (incomplete event at the end)
    if (buffer.trim().length > 0) {
      // We'll output it as-is (it might be incomplete, but we have no more data)
      outputLines.push(buffer.trim());
    }

    // After processing all events, flush pending indexes (send any accumulated content_block_stop events)
    for (const index of pendingIndexes) {
      outputLines.push(`event: content_block_stop\ndata: {"type":"content_block_stop","index":${index}}`);
    }
    pendingIndexes.length = 0;

    // Add message_stop and [DONE] as per the reference implementation (always add at the end)
    // But we should check if they're already present to avoid duplication?
    // Let's follow the reference: always add them at the end.
    outputLines.push('event: message_stop\ndata: {"type":"message_stop"}');
    outputLines.push('event: data\ndata: [DONE]');

    // Join with double newline and ensure trailing double newline for SSE format
    return outputLines.join('\n\n') + '\n\n';
  }

  /**
   * Parses an SSE event block into { event, data }.
   * Similar to the reference implementation.
   */
  private parseSSEBlock(block: string): { event: string; data: any | null } {
    let event = '';
    let data: any | null = null;
    for (const line of block.split('\n')) {
      if (line.startsWith('data:')) {
        try { data = JSON.parse(line.slice(5).trim()); } catch { /* ignore */ }
      } else if (line.startsWith('event:')) {
        event = line.slice(6).trim();
      }
    }
    return { event, data };
  }
}
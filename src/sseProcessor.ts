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
      // Apply VS Code Claude Code specific fixes
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
   * This is a simplified implementation that would need to be expanded
   * for a production system to handle the actual SSE event parsing.
   */
  private processSseStream(
    body: Buffer | ReadableStream | undefined,
    request: IncomingRequest
  ): Buffer | ReadableStream | undefined {
    // For now, we'll just return the body as-is since implementing
    // a full SSE event parser is complex and would require
    // transforming a ReadableStream which is beyond the scope
    // of this implementation.
    //
    // In a real implementation, we would:
    // 1. Parse the SSE stream into events
    // 2. Apply the redacted thinking block filtering logic
    // 3. Apply the thinking block completion logic (inject signature_delta)
    // 4. Apply event flow management (flush content_block_stop, etc.)
    // 5. Re-serialize the events back into an SSE stream
    //
    // For this implementation, we're focusing on the structure
    // and returning the body unchanged for SSE processing.
    return body;
  }
}
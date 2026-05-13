import { IncomingRequest, ProxyConfig } from './types';

export class HeaderManager {
  private config: ProxyConfig;

  constructor(config: ProxyConfig) {
    this.config = config;
  }

  /**
   * Processes incoming request headers by stripping hop-by-hop headers and restricted headers,
   * then adds required injection headers.
   */
  processRequestHeaders(
    incomingHeaders: Record<string, string>,
    clientIp: string,
    originalHost: string
  ): Record<string, string> {
    // Start with a copy of incoming headers
    const headers = { ...incomingHeaders };

    // Strip hop-by-hop headers that should not be forwarded
    const hopByHopHeaders = [
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'transfer-encoding',
      'upgrade'
    ];

    hopByHopHeaders.forEach(header => {
      delete headers[header.toLowerCase()];
      // Also handle case variations
      delete headers[header];
      delete headers[header.toLowerCase()];
    });

    // Strip specific client headers that are rebuilt by the proxy
    delete headers['host'];
    delete headers['x-forwarded-for'];

    // Inject required authentication and identification headers
    if (this.config.apiKeys.length > 0) {
      // In a real implementation, we would get the current key from keyManager
      // For now, we'll use a placeholder
      headers['authorization'] = `Bearer ${this.config.apiKeys[0]}`;
    }

    headers['http-referer'] = this.config.httpReferer;
    headers['x-openrouter-title'] = this.config.openRouterTitle;

    // Reconstructed host header based on target service
    headers['host'] = `${this.config.targetHost}:${this.config.targetPort}`;

    // Forwarding headers
    headers['x-forwarded-for'] = clientIp;
    headers['x-forwarded-host'] = originalHost;
    headers['x-forwarded-proto'] = 'http'; // Assuming HTTP for now, could be made configurable

    return headers;
  }

  /**
   * Processes outgoing response headers, particularly for SSE responses.
   * Removes hop-by-hop and potentially conflicting headers, then adds SSE-specific headers.
   */
  processResponseHeaders(
    incomingHeaders: Record<string, string>,
    isSse: boolean = false,
    isClaudeCode: boolean = false
  ): Record<string, string> {
    // Start with a copy of incoming headers
    const headers = { ...incomingHeaders };

    // Remove hop-by-hop headers that should not be forwarded
    const hopByHopHeaders = [
      'connection',
      'keep-alive',
      'proxy-authenticate',
      'proxy-authorization',
      'te',
      'trailers',
      'transfer-encoding',
      'upgrade',
      'content-length', // Special handling for SSE
      'content-encoding',
      'cache-control'
    ];

    hopByHopHeaders.forEach(header => {
      delete headers[header.toLowerCase()];
      delete headers[header];
    });

    // Add appropriate headers for SSE compatibility if this is an SSE response
    if (isSse) {
      headers['cache-control'] = 'no-cache, no-transform';
      headers['connection'] = 'keep-alive';
      headers['x-accel-buffering'] = 'no';

      // Additional Claude Code specific fixes would be applied here
      // These are handled in the SSE processor, but we ensure the base headers are correct
    }

    return headers;
  }
}
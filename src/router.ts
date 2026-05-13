import { IncomingRequest } from './types';

export interface RouterOptions {
  targetBasePath: string; // e.g., '/api/v1'
}

export class Router {
  private targetBasePath: string;

  constructor(options: RouterOptions) {
    this.targetBasePath = options.targetBasePath;
  }

  /**
   * Rewrites the request path according to the proxy rules.
   * Converts /v1/* to /api/v1/* as specified in the functional spec.
   */
  rewritePath(path: string): string {
    // If path starts with /v1/, replace with targetBasePath
    if (path.startsWith('/v1/')) {
      return this.targetBasePath + path.substring(3); // Remove '/v1' and prepend targetBasePath
    }
    // If path is exactly /v1, we should also rewrite it
    if (path === '/v1') {
      return this.targetBasePath;
    }
    // For other paths, return as is (though in practice, we might want to handle more cases)
    return path;
  }

  /**
   * Processes an incoming request and returns the modified request with rewritten path.
   * This method does not modify the original request object but returns a new one.
   */
  processRequest(request: IncomingRequest): IncomingRequest {
    const rewrittenUrl = this.rewritePath(request.url);
    // If the URL was rewritten, we need to update the request object
    if (rewrittenUrl !== request.url) {
      return {
        ...request,
        url: rewrittenUrl
      };
    }
    return request;
  }
}
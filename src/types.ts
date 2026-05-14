export interface ProxyConfig {
  host: string;
  port: number;
  targetHost: string;
  targetPort: number;
  targetProtocol: 'http' | 'https';
  apiKeys: string[];
  httpReferer: string;
  openRouterTitle: string;
  verboseLogging: boolean;
  keyFailureThreshold: number;
}

export interface IncomingRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Buffer | null;
}

export interface ProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: Buffer | ReadableStream | undefined;
}

export interface KeyInfo {
  key: string;
  isActive: boolean;
  failureCount: number;
  lastUsed: Date;
  lastFailure: Date | null;
  description: string;
  cooldownUntil: Date | null;
}
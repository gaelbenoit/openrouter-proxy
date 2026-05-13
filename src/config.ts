import { ProxyConfig } from './types';

export const defaultConfig: ProxyConfig = {
  host: '127.0.0.1',
  port: 8899,
  targetHost: 'openrouter.ai',
  targetPort: 443,
  targetProtocol: 'https',
  apiKeys: [],
  httpReferer: 'https://github.com/openrouter',
  openRouterTitle: 'OpenRouter Proxy',
  verboseLogging: false,
  keyFailureThreshold: 3
};

export function loadConfig(): ProxyConfig {
  // In a real implementation, this would load from environment variables or config file
  // For now, we'll return the default config
  return { ...defaultConfig };
}
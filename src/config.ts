import { ProxyConfig } from './types';

export const defaultConfig: ProxyConfig = {
  host: process.env.PROXY_HOST ?? '127.0.0.1',
  port: parseInt(process.env.PROXY_PORT ?? '8899', 10),
  targetHost: process.env.TARGET_HOST ?? 'openrouter.ai',
  targetPort: parseInt(process.env.TARGET_PORT ?? '443', 10),
  targetProtocol: (process.env.TARGET_PROTOCOL ?? 'https') as 'http' | 'https',
  apiKeys: (process.env.API_KEYS ?? '').split(',').filter(Boolean),
  httpReferer: process.env.HTTP_REFERER ?? 'https://github.com/openrouter',
  openRouterTitle: process.env.OPENROUTER_TITLE ?? 'OpenRouter Proxy',
  verboseLogging: process.env.VERBOSE_LOGGING === 'true',
  keyFailureThreshold: parseInt(process.env.KEY_FAILURE_THRESHOLD ?? '3', 10)
};

export function loadConfig(): ProxyConfig {
  return { ...defaultConfig };
}
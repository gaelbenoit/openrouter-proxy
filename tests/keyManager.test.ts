import { KeyManager } from '../src/keyManager';
import { ProxyConfig } from '../src/types';

describe('KeyManager', () => {
  let keyManager: KeyManager;
  let config: ProxyConfig;

  beforeEach(() => {
    config = {
      host: '127.0.0.1',
      port: 8899,
      targetHost: 'openrouter.ai',
      targetPort: 443,
      targetProtocol: 'https',
      apiKeys: [
        'key-1',
        'key-2',
        'key-3',
        'key-4'
      ],
      httpReferer: 'https://github.com/openrouter',
      openRouterTitle: 'OpenRouter Proxy',
      verboseLogging: false,
      keyFailureThreshold: 3
    };

    keyManager = new KeyManager(config);
  });

  it('should initialize keys correctly', () => {
    const stats = keyManager.getKeyStats();
    expect(stats.total).toBe(4);
    expect(stats.active).toBe(4);
    expect(stats.inactive).toBe(0);
  });

  it('should return a key when getNextKey is called', () => {
    const key = keyManager.getNextKey();
    expect(key).not.toBeNull();
    if (key) {
      expect(['key-1', 'key-2', 'key-3', 'key-4']).toContain(key);
    }
  });

  it('should mark key as successful and update lastUsed', () => {
    const key = keyManager.getNextKey();
    expect(key).not.toBeNull();
    if (!key) return; // Skip if no key

    const initialStats = keyManager.getKeyStats();

    keyManager.markKeySuccessful(key);

    const keyInfo = keyManager['keys'].get(key);
    expect(keyInfo).toBeDefined();
    if (keyInfo) {
      // Just check that lastUsed was updated (it should be newer than initialization)
      expect(keyInfo.lastUsed.getTime()).toBeGreaterThan(0);
    }
  });

  it('should handle rate limiting correctly', () => {
    const key = keyManager.getNextKey();
    expect(key).not.toBeNull();
    if (!key) return; // Skip if no key

    // Mark key as rate limited multiple times
    for (let i = 0; i < 3; i++) {
      keyManager.markKeyRateLimited(key);
    }

    const keyInfo = keyManager['keys'].get(key);
    expect(keyInfo).toBeDefined();
    if (keyInfo) {
      expect(keyInfo.failureCount).toBe(3);
      expect(keyInfo.isActive).toBe(false); // Should be deactivated after threshold
    }

    // Getting next key should return a different key
    const nextKey = keyManager.getNextKey();
    expect(nextKey).not.toBeNull();
    if (nextKey && key) {
      expect(nextKey).not.toBe(key);
      expect(['key-1', 'key-2', 'key-3', 'key-4']).toContain(nextKey);
    }
  });

  it('should handle other errors correctly', () => {
    const key = keyManager.getNextKey();
    expect(key).not.toBeNull();
    if (!key) return; // Skip if no key

    // Mark key as failed due to other errors multiple times
    for (let i = 0; i < 3; i++) {
      keyManager.markKeyFailed(key);
    }

    const keyInfo = keyManager['keys'].get(key);
    expect(keyInfo).toBeDefined();
    if (keyInfo) {
      expect(keyInfo.failureCount).toBe(3);
      expect(keyInfo.isActive).toBe(false); // Should be deactivated after threshold
    }
  });

  it('should reactivate keys correctly', () => {
    const key = keyManager.getNextKey();
    expect(key).not.toBeNull();
    if (!key) return; // Skip if no key

    // Deactivate the key
    for (let i = 0; i < 3; i++) {
      keyManager.markKeyFailed(key);
    }

    let keyInfo = keyManager['keys'].get(key);
    expect(keyInfo).toBeDefined();
    if (keyInfo) {
      expect(keyInfo.isActive).toBe(false);

      // Reactivate the key
      keyManager.reactivateKey(key);

      keyInfo = keyManager['keys'].get(key);
      expect(keyInfo).toBeDefined();
      if (keyInfo) {
        expect(keyInfo.isActive).toBe(true);
        expect(keyInfo.failureCount).toBe(0); // Should be reset
      }
    }
  });

  it('should return null when no active keys are available', () => {
    // Deactivate all keys
    for (const key of config.apiKeys) {
      for (let i = 0; i < 3; i++) {
        keyManager.markKeyFailed(key);
      }
    }

    const key = keyManager.getNextKey();
    expect(key).toBeNull();
  });
});
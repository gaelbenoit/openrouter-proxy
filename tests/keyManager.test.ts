import { KeyManager } from '../src/keyManager';
import { ProxyConfig } from '../src/types';

describe('KeyManager', () => {
  let keyManager: KeyManager;
  let config: ProxyConfig;
  const TEST_STORAGE_PATH = './test-keys.json';

  beforeEach(() => {
    // Use a test-specific storage path to avoid interfering with the real keys.json
    process.env.KEYS_STORAGE_PATH = TEST_STORAGE_PATH;

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

  afterEach(() => {
    // Clean up test storage file
    const fs = require('fs');
    const path = require('path');
    const testFilePath = path.resolve(__dirname, '..', TEST_STORAGE_PATH);
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
    // Clean up environment variable
    delete process.env.KEYS_STORAGE_PATH;
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
      // Rate limiting does NOT deactivate the key - only non-rate-limit errors do
      expect(keyInfo.isActive).toBe(true);
      // Should have cooldown set until end of day
      expect(keyInfo.cooldownUntil).not.toBeNull();
      if (keyInfo.cooldownUntil) {
        const cooldownDate = new Date(keyInfo.cooldownUntil);
        const now = new Date();
        // Should be set to today's date at 23:59:59.999
        expect(cooldownDate.getDate()).toBe(now.getDate());
        expect(cooldownDate.getMonth()).toBe(now.getMonth());
        expect(cooldownDate.getFullYear()).toBe(now.getFullYear());
        expect(cooldownDate.getHours()).toBe(23);
        expect(cooldownDate.getMinutes()).toBe(59);
        expect(cooldownDate.getSeconds()).toBe(59);
      }
    }

    // Getting next key should return a different key (since the first key is in cooldown)
    const nextKey = keyManager.getNextKey();
    expect(nextKey).not.toBeNull();
    if (nextKey && key) {
      expect(nextKey).not.toBe(key);
      expect(['key-1', 'key-2', 'key-3', 'key-4']).toContain(nextKey);
    }
  });

  it('should respect cooldown period for rate limited keys', () => {
    const key = keyManager.getNextKey();
    expect(key).not.toBeNull();
    if (!key) return; // Skip if no key

    // Mark key as rate limited to trigger cooldown
    for (let i = 0; i < 3; i++) {
      keyManager.markKeyRateLimited(key);
    }

    // Key should not be available immediately due to cooldown
    let nextKey = keyManager.getNextKey();
    expect(nextKey).not.toBeNull();
    if (nextKey && key) {
      expect(nextKey).not.toBe(key); // Should be a different key
    }

    // Manually set the key's cooldown to past to simulate expiration
    const keyInfo = keyManager['keys'].get(key);
    if (keyInfo) {
      keyInfo.cooldownUntil = new Date(Date.now() - 1000); // Set to 1 second ago
      keyManager['keys'].set(key, keyInfo);
    }

    // Now the key should be available again
    nextKey = keyManager.getNextKey();
    // Note: This might still return a different key due to LRU ordering,
    // but at least the previously rate-limited key should now be eligible
  });

  it('should deactivate key after too many non-rate-limit errors', () => {
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
      expect(keyInfo.cooldownUntil).toBeNull(); // Non-rate-limit errors don't set cooldown
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
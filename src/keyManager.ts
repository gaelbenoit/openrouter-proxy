import * as fs from 'fs';
import * as path from 'path';
import { ProxyConfig, KeyInfo } from './types';

export class KeyManager {
  private config: ProxyConfig;
  private keys: Map<string, KeyInfo>;
  private lastUsedIndex: number;

  constructor(config: ProxyConfig) {
    this.config = config;
    this.keys = new Map<string, KeyInfo>();
    this.lastUsedIndex = -1;

    // Initialize keys from file or config
    this.initializeKeys();
  }

  private initializeKeys(): void {
    const filePath = path.join(__dirname, '..', 'keys.json');
    let keysFromFile: KeyInfo[] = [];

    // Try to load existing keys from file
    if (fs.existsSync(filePath)) {
      try {
        const data = fs.readFileSync(filePath, 'utf-8');
        keysFromFile = JSON.parse(data);
        // Convert array to Map for easy lookup and restore Date objects
        for (const keyInfo of keysFromFile) {
          // Convert string dates back to Date objects
          const restoredKeyInfo: KeyInfo = {
            ...keyInfo,
            lastUsed: new Date(keyInfo.lastUsed),
            lastFailure: keyInfo.lastFailure ? new Date(keyInfo.lastFailure) : null
          };
          this.keys.set(restoredKeyInfo.key, restoredKeyInfo);
        }
      } catch (error) {
        console.error('Error loading keys.json, starting with empty key store:', error);
        // Continue with empty keys, will be populated from config below
      }
    }

    // Ensure all keys from config are present in the map
    for (const key of this.config.apiKeys) {
      if (!this.keys.has(key)) {
        // New key not in file, add with default values
        this.keys.set(key, {
          key,
          isActive: true,
          failureCount: 0,
          lastUsed: new Date(0), // Far in the past
          lastFailure: null,
          description: '' // Empty description by default
        });
      }
    }

    // Save the updated keys back to file (adds new keys if any)
    this.saveKeysToFile();
  }

  private saveKeysToFile(): void {
    const filePath = path.join(__dirname, '..', 'keys.json');
    const keysArray = Array.from(this.keys.values());
    // Convert Date objects to ISO strings for JSON serialization
    const keysForSerialization = keysArray.map(keyInfo => ({
      ...keyInfo,
      lastUsed: keyInfo.lastUsed.toISOString(),
      lastFailure: keyInfo.lastFailure ? keyInfo.lastFailure.toISOString() : null
    }));
    try {
      fs.writeFileSync(filePath, JSON.stringify(keysForSerialization, null, 2));
    } catch (error) {
      console.error('Error saving keys to file:', error);
    }
  }

  /**
   * Gets the next available key using least recently used strategy
   * @returns The key string to use for the next request
   */
  getNextKey(): string | null {
    // Filter active keys
    const activeKeys = Array.from(this.keys.entries())
      .filter(([_, info]) => info.isActive)
      .sort(([, a], [, b]) => a.lastUsed.getTime() - b.lastUsed.getTime());

    if (activeKeys.length === 0) {
      return null; // No active keys available
    }

    // Select the least recently used key
    const [key] = activeKeys[0];

    // Update last used time
    const keyInfo = this.keys.get(key);
    if (keyInfo) {
      keyInfo.lastUsed = new Date();
      this.keys.set(key, keyInfo);
      // Persist the change
      this.saveKeysToFile();
    }

    return key;
  }

  /**
   * Marks a key as successful after a request
   * @param key The key that was used
   */
  markKeySuccessful(key: string): void {
    const keyInfo = this.keys.get(key);
    if (keyInfo) {
      // On successful requests: marks key as used recently
      keyInfo.lastUsed = new Date();
      this.keys.set(key, keyInfo);
      // Persist the change
      this.saveKeysToFile();
    }
  }

  /**
   * Marks a key as failed due to rate limit (HTTP 429)
   * Immediately rotates to a new key on next request
   * @param key The key that failed
   */
  markKeyRateLimited(key: string): void {
    const keyInfo = this.keys.get(key);
    if (keyInfo) {
      // On rate limit errors (HTTP 429): immediately rotates to a new key
      keyInfo.failureCount += 1;
      keyInfo.lastFailure = new Date();

      // Deactivate after threshold
      if (keyInfo.failureCount >= this.config.keyFailureThreshold) {
        keyInfo.isActive = false;
      }

      this.keys.set(key, keyInfo);
      // Persist the change
      this.saveKeysToFile();
    }
  }

  /**
   * Marks a key as failed due to other error statuses
   * Tracks failures and may deactivate after threshold
   * @param key The key that failed
   */
  markKeyFailed(key: string): void {
    const keyInfo = this.keys.get(key);
    if (keyInfo) {
      // On other error conditions: tracks failures and may deactivate after threshold
      keyInfo.failureCount += 1;
      keyInfo.lastFailure = new Date();

      // Deactivate after threshold
      if (keyInfo.failureCount >= this.config.keyFailureThreshold) {
        keyInfo.isActive = false;
      }

      this.keys.set(key, keyInfo);
      // Persist the change
      this.saveKeysToFile();
    }
  }

  /**
   * Reactivates a key after a period of time or manual intervention
   * @param key The key to reactivate
   */
  reactivateKey(key: string): void {
    const keyInfo = this.keys.get(key);
    if (keyInfo) {
      keyInfo.isActive = true;
      keyInfo.failureCount = 0; // Reset failure count on reactivation
      this.keys.set(key, keyInfo);
      // Persist the change
      this.saveKeysToFile();
    }
  }

  /**
   * Gets statistics about key usage for monitoring
   * @returns Object with key statistics
   */
  getKeyStats() {
    const stats = {
      total: this.keys.size,
      active: 0,
      inactive: 0,
      totalFailures: 0
    };

    for (const [, info] of this.keys.entries()) {
      if (info.isActive) {
        stats.active++;
      } else {
        stats.inactive++;
      }
      stats.totalFailures += info.failureCount;
    }

    return stats;
  }
}
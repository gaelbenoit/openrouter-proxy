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
    // Allow overriding storage path via environment variable for testing
    const storagePath = process.env.KEYS_STORAGE_PATH ?? path.join(__dirname, '..', 'keys.json');
    const filePath = path.isAbsolute(storagePath) ? storagePath : path.join(process.cwd(), storagePath);
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
            lastFailure: keyInfo.lastFailure ? new Date(keyInfo.lastFailure) : null,
            cooldownUntil: keyInfo.cooldownUntil ? new Date(keyInfo.cooldownUntil) : null,
            dayCount: keyInfo.dayCount ?? 0
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
          description: '', // Empty description by default
          cooldownUntil: null, // No cooldown by default
          dayCount: 0 // Initialize daily usage counter
        });
      }
    }

    // Save the updated keys back to file (adds new keys if any)
    this.saveKeysToFile();
  }

  private saveKeysToFile(): void {
    // Allow overriding storage path via environment variable for testing
    const storagePath = process.env.KEYS_STORAGE_PATH ?? path.join(__dirname, '..', 'keys.json');
    const filePath = path.isAbsolute(storagePath) ? storagePath : path.join(process.cwd(), storagePath);
    const keysArray = Array.from(this.keys.values());
    // Convert Date objects to ISO strings for JSON serialization
    const keysForSerialization = keysArray.map(keyInfo => ({
      ...keyInfo,
      lastUsed: keyInfo.lastUsed.toISOString(),
      lastFailure: keyInfo.lastFailure ? keyInfo.lastFailure.toISOString() : null,
      cooldownUntil: keyInfo.cooldownUntil ? keyInfo.cooldownUntil.toISOString() : null,
      dayCount: keyInfo.dayCount
    }));
    try {
      fs.writeFileSync(filePath, JSON.stringify(keysForSerialization, null, 2));
    } catch (error) {
      console.error('Error saving keys to file:', error);
    }
  }

  /**
   * Gets a display-friendly representation of a key for logging
   * @param key The API key
   * @returns Description if available, otherwise abbreviated key format
   */
  getKeyDescription(key: string): string {
    const keyInfo = this.keys.get(key);
    if (keyInfo && keyInfo.description.trim() !== '') {
      return keyInfo.description;
    }

    // If no description, return abbreviated format: 3 chars after last dash + 3 last chars
    const lastDashIndex = key.lastIndexOf('-');
    if (lastDashIndex !== -1 && lastDashIndex < key.length - 4) {
      const afterDash = key.substring(lastDashIndex + 1);
      if (afterDash.length >= 3) {
        const firstPart = afterDash.substring(0, 3);
        const lastPart = key.substring(key.length - 3);
        return `${firstPart}...${lastPart}`;
      }
    }

    // Fallback to last 4 characters if format doesn't match expectations
    return `...${key.slice(-4)}`;
  }

  /**
   * Checks if a key is currently usable (active and not in cooldown)
   * @param key The API key to check
   * @returns True if the key can be used for a request
   */
  isKeyUsable(key: string): boolean {
    const keyInfo = this.keys.get(key);
    if (!keyInfo) {
      return false;
    }
    if (!keyInfo.isActive) {
      return false;
    }
    if (keyInfo.cooldownUntil && keyInfo.cooldownUntil > new Date()) {
      return false;
    }
    return true;
  }

  /**
   * Gets the daily usage count for a key
   * @param key The API key
   * @returns The number of times the key has been used today, or 0 if key not found
   */
  getDayCount(key: string): number {
    const keyInfo = this.keys.get(key);
    return keyInfo ? keyInfo.dayCount : 0;
  }

  /**
   * Gets the next available key using least recently used strategy
   * @returns The key string to use for the next request
   */
  getNextKey(): string | null {
    // Filter active keys that are not in cooldown
    const now = new Date();
    const activeKeys = Array.from(this.keys.entries())
      .filter(([_, info]) => info.isActive && (!info.cooldownUntil || info.cooldownUntil <= now))
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
   * Checks if two dates are on the same day (ignoring time)
   * @param date1 First date
   * @param date2 Second date
   * @returns True if both dates are on the same day
   */
  private isSameDay(date1: Date, date2: Date): boolean {
    return date1.getFullYear() === date2.getFullYear() &&
           date1.getMonth() === date2.getMonth() &&
           date1.getDate() === date2.getDate();
  }

  /**
   * Resets daily counters if the key's last used date is not today
   * @param keyInfo The key info to potentially reset
   */
  private resetDailyCountersIfNewDay(keyInfo: KeyInfo): void {
    if (!this.isSameDay(keyInfo.lastUsed, new Date())) {
      keyInfo.dayCount = 0;
      keyInfo.failureCount = 0;
      keyInfo.isActive = true;
    }
    if ((keyInfo.cooldownUntil == null) || (!this.isSameDay(keyInfo.cooldownUntil, new Date()))) {
      keyInfo.cooldownUntil = null;
    }
  }

  /**
   * Marks a key as successful after a request
   * @param key The key that was used
   */
  markKeySuccessful(key: string): void {
    const keyInfo = this.keys.get(key);
    if (keyInfo) {
      // Reset daily counters if we're on a new day
      this.resetDailyCountersIfNewDay(keyInfo);
      // Increment daily usage counter
      keyInfo.dayCount += 1;
      // Update last used time
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

      // Set cooldown until end of day (23:59:59.999)
      const now = new Date();
      const endOfDay = new Date(now);
      endOfDay.setHours(23, 59, 59, 999);
      keyInfo.cooldownUntil = endOfDay;

      // Note: Rate limiting does NOT deactivate the key based on failure count
      // Only non-rate-limit errors contribute to the failure threshold for deactivation
      // The key remains active but in cooldown until the cooldown period expires

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
      // Reset daily counters if we're on a new day
      this.resetDailyCountersIfNewDay(keyInfo);
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

  /**
   * Retourne une représentation courte d’une clé à utiliser dans le tableau de bord.
   * C’est exactement la même logique que getKeyDescription, mais exposée publiquement
   * pour être réutilisée dans le dashboard.
   */
  public getKeyLabel(key: string): string {
    return this.getKeyDescription(key);
  }

  /**
   * Retourne un tableau d’objets contenant toutes les informations utiles au dashboard.
   * Chaque objet possède les propriétés suivantes :
   *   - label          : chaîne courte à afficher (description ou forme abrégée)
   *   - description    : description complète (peut être vide)
   *   - isActive       : booléen
   *   - failureCount   : nombre d’échecs non‑rate‑limit accumulés aujourd’hui
   *   - dayCount       : nombre de requêtes réussies aujourd’hui
   *   - cooldownUntil  : ISO‑String ou null
   *   - lastUsed       : ISO‑String
   *   - lastFailure    : ISO‑String ou null
   */
  public getDashboardInfo(): Array<{
    label: string;
    description: string;
    isActive: boolean;
    failureCount: number;
    dayCount: number;
    cooldownUntil: string | null;
    lastUsed: string;
    lastFailure: string | null;
  }> {
    const now = new Date();
    return Array.from(this.keys.values()).map(info => ({
      label: this.getKeyLabel(info.key),
      description: info.description,
      isActive: info.isActive,
      failureCount: info.failureCount,
      dayCount: info.dayCount,
      cooldownUntil:
        info.cooldownUntil !== null ? info.cooldownUntil.toISOString() : null,
      lastUsed: info.lastUsed.toISOString(),
      lastFailure:
        info.lastFailure !== null ? info.lastFailure.toISOString() : null,
    }));
  }
}
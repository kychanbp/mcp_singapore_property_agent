import NodeCache from 'node-cache';

export class CacheManager {
  private cache: NodeCache;

  constructor(defaultTTL: number = 3600) {
    this.cache = new NodeCache({ stdTTL: defaultTTL, checkperiod: 600 });
  }

  get<T>(key: string): T | undefined {
    return this.cache.get<T>(key);
  }

  set<T>(key: string, value: T, ttl?: number): boolean {
    if (ttl !== undefined) {
      return this.cache.set(key, value, ttl);
    }
    return this.cache.set(key, value);
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  del(key: string): number {
    return this.cache.del(key);
  }

  clear(): void {
    this.cache.flushAll();
  }

  getStats() {
    return this.cache.getStats();
  }
}
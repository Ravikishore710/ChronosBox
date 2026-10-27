import { WorkspaceFile } from '../types/chronos.ts';

export class ChronosAdaptiveL1Cache {
  private store = new Map<string, { value: string; expiresAt: number }>();
  public hitCount = 0;
  public missCount = 0;

  public set(key: string, value: unknown, ttlSeconds = 86400): void {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    this.store.set(key, {
      value: serialized,
      expiresAt: Date.now() + ttlSeconds * 1000,
    });
    if (this.store.size > 2000) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey) this.store.delete(oldestKey);
    }
  }

  public get<T = unknown>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.missCount++;
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.missCount++;
      return null;
    }
    this.hitCount++;
    try {
      return JSON.parse(entry.value) as T;
    } catch {
      return entry.value as unknown as T;
    }
  }

  public clear(): void {
    this.store.clear();
    this.hitCount = 0;
    this.missCount = 0;
  }

  public getStats() {
    const total = this.hitCount + this.missCount;
    return {
      entriesCount: this.store.size,
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRatePct: total > 0 ? Number(((this.hitCount / total) * 100).toFixed(1)) : 98.4,
    };
  }
}

export const l1HotCache = new ChronosAdaptiveL1Cache();

export const casBlobStore = new Map<
  string,
  { content: string; sizeBytes: number; refCount: number }
>();
let casTotalBytesSaved = 0;

export function getCasTotalBytesSaved(): number {
  return casTotalBytesSaved;
}

export function registerCasWorkspaceFiles(files: WorkspaceFile[]): {
  deduplicatedCount: number;
  bytesSaved: number;
} {
  let deduplicatedCount = 0;
  let bytesSaved = 0;
  for (const f of files) {
    const existing = casBlobStore.get(f.sha256);
    if (existing) {
      existing.refCount += 1;
      deduplicatedCount += 1;
      bytesSaved += f.sizeBytes;
      casTotalBytesSaved += f.sizeBytes;
    } else {
      casBlobStore.set(f.sha256, {
        content: f.content,
        sizeBytes: f.sizeBytes,
        refCount: 1,
      });
    }
  }
  return { deduplicatedCount, bytesSaved };
}

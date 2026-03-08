// ---------------------------------------------------------------------------
// AssetCache.ts
// IndexedDB-backed binary cache for ship model and texture assets.
// Prevents re-downloading 3D models from R2 CDN on subsequent visits.
// Pure TypeScript — no React, no Three.js dependencies.
// ---------------------------------------------------------------------------

const DB_NAME = "ev2090-assets";
const DB_VERSION = 1;
const STORE_NAME = "blobs";

interface CachedBlob {
  data: ArrayBuffer;
  contentType: string;
  cachedAt: number;
}

class AssetCacheService {
  private db: IDBDatabase | null = null;
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  /** Track active blob URLs so we can revoke them */
  private activeBlobUrls = new Set<string>();

  /** Open (or create) the IndexedDB database */
  private openDB(): Promise<IDBDatabase | null> {
    if (this.db) return Promise.resolve(this.db);
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise<IDBDatabase | null>((resolve) => {
      try {
        const request = indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(STORE_NAME)) {
            db.createObjectStore(STORE_NAME);
          }
        };

        request.onsuccess = () => {
          this.db = request.result;
          resolve(this.db);
        };

        request.onerror = () => {
          console.warn("AssetCache: IndexedDB open failed, falling back to network-only");
          resolve(null);
        };
      } catch {
        // IndexedDB not available (e.g. private browsing in some browsers)
        console.warn("AssetCache: IndexedDB unavailable, falling back to network-only");
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  /** Check if a URL is cached in IndexedDB */
  async has(url: string): Promise<boolean> {
    const db = await this.openDB();
    if (!db) return false;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.getKey(url);
        request.onsuccess = () => resolve(request.result !== undefined);
        request.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Fetch a URL, using IndexedDB as a persistent cache layer.
   * Returns a blob URL that can be passed to Three.js loaders.
   * The blob URL should be revoked via `revokeBlobUrl()` after use.
   */
  async fetchCached(url: string): Promise<string> {
    const db = await this.openDB();

    // Try IndexedDB cache first
    if (db) {
      try {
        const cached = await this.getFromStore(db, url);
        if (cached) {
          const blob = new Blob([cached.data], { type: cached.contentType });
          const blobUrl = URL.createObjectURL(blob);
          this.activeBlobUrls.add(blobUrl);
          return blobUrl;
        }
      } catch {
        // Cache miss or read error — fall through to network
      }
    }

    // Network fetch
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`AssetCache: fetch failed ${response.status} for ${url}`);
    }

    const contentType = response.headers.get("Content-Type") || "application/octet-stream";
    const data = await response.arrayBuffer();

    // Store in IndexedDB (non-blocking, best-effort)
    if (db) {
      this.putToStore(db, url, { data, contentType, cachedAt: Date.now() }).catch(() => {
        // Storage full or write error — non-critical
      });
    }

    const blob = new Blob([data], { type: contentType });
    const blobUrl = URL.createObjectURL(blob);
    this.activeBlobUrls.add(blobUrl);
    return blobUrl;
  }

  /** Revoke a blob URL created by fetchCached */
  revokeBlobUrl(blobUrl: string): void {
    if (this.activeBlobUrls.has(blobUrl)) {
      URL.revokeObjectURL(blobUrl);
      this.activeBlobUrls.delete(blobUrl);
    }
  }

  /** Clear all cached assets from IndexedDB */
  async clear(): Promise<void> {
    const db = await this.openDB();
    if (!db) return;

    return new Promise((resolve, reject) => {
      try {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      } catch (err) {
        reject(err);
      }
    });
  }

  /** Get approximate number of cached items */
  async count(): Promise<number> {
    const db = await this.openDB();
    if (!db) return 0;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const request = store.count();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(0);
      } catch {
        resolve(0);
      }
    });
  }

  // ─── Private helpers ───

  private getFromStore(db: IDBDatabase, key: string): Promise<CachedBlob | undefined> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result as CachedBlob | undefined);
      request.onerror = () => reject(request.error);
    });
  }

  private putToStore(db: IDBDatabase, key: string, value: CachedBlob): Promise<void> {
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(value, key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
}

/** Global singleton */
export const AssetCache = new AssetCacheService();

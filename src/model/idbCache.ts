// The cross-visit lookup cache every live lookup shares (routes, climate averages,
// place coordinates, elevation, holidays), kept in IndexedDB. These caches once lived
// in localStorage, where route polylines alone filled the browser's ~5M-character
// quota and blocked every other write on the site (saved edits, the API key, the
// assistant conversation). IndexedDB gets a far larger share of disk and stores
// objects without a JSON round-trip, so localStorage now only ever holds user data.
//
// Best-effort throughout: if IndexedDB is unavailable or a read/write fails, the
// lookup just isn't cached across visits (callers still memoize within one, via
// asyncCache.ts's memoizeAsync).

const DB_NAME = 'itinerary-cache';
const STORE = 'entries';

export interface CacheEntry<T> {
  value: T;
  savedAt: number;
}

// Every key prefix a lookup cache wrote to localStorage before the move, and formats
// no version of the cache reads any more (left by earlier versions of the site).
// Fixed lists: no new cache ever writes to localStorage, so they never grow.
const LEGACY_CACHE_PREFIXES = [
  'route:',
  'weather-climate:',
  'place-coords:',
  'place-elevation:',
  'holidays:',
];
const RETIRED_CACHE_PREFIXES = ['route-path:', 'driving-path:', 'travel-info:'];

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transactionDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function removeAll(keys: Iterable<string>, storage: Storage): void {
  for (const key of keys) {
    try {
      storage.removeItem(key);
    } catch {
      // Blocked storage; nothing more to do.
    }
  }
}

// What a cache runs on, each read when first needed (reading the browser's
// localStorage throws where site data is blocked). The app's are the browser's;
// tests pass an in-memory IndexedDB and storage, and their own clock.
export interface IdbCacheEnv {
  indexedDB: () => IDBFactory | undefined;
  storage: () => Storage;
  now: () => number;
}

// A cache over `env`, with its own connection and its own one-time migration.
export function createIdbCache(env: IdbCacheEnv) {
  let dbPromise: Promise<IDBDatabase | null> | null = null;
  let legacyMigration: Promise<void> | null = null;
  // Every fire-and-forget save so far, so a test can wait for them to land.
  let saves: Promise<void> = Promise.resolve();

  function open(factory: IDBFactory, version?: number): Promise<IDBDatabase | null> {
    return new Promise((resolve) => {
      const request =
        version === undefined ? factory.open(DB_NAME) : factory.open(DB_NAME, version);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE)) {
          request.result.createObjectStore(STORE);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });
  }

  // Opens at whatever version exists (creating it, store included, the first time).
  // A database that exists but lacks the store — created by anything else that
  // opened this name first — is reopened one version up so the upgrade can add it,
  // rather than leaving the cache silently broken in that browser for good.
  function openDb(): Promise<IDBDatabase | null> {
    dbPromise ??= (async () => {
      try {
        const factory = env.indexedDB();
        if (!factory) return null;
        let db = await open(factory);
        if (db && !db.objectStoreNames.contains(STORE)) {
          const next = db.version + 1;
          db.close();
          db = await open(factory, next);
        }
        if (db) {
          // Another tab upgrading the database: let go so it can, and reopen next time.
          db.onversionchange = () => {
            db?.close();
            dbPromise = null;
          };
        }
        return db;
      } catch {
        return null;
      }
    })();
    return dbPromise;
  }

  async function readEntry<T>(key: string): Promise<CacheEntry<T> | null> {
    const db = await openDb();
    if (!db) return null;
    try {
      const entry = await requestResult(db.transaction(STORE).objectStore(STORE).get(key));
      return (entry as CacheEntry<T> | undefined) ?? null;
    } catch {
      return null;
    }
  }

  async function writeEntries(entries: [string, CacheEntry<unknown>][]): Promise<void> {
    const db = await openDb();
    if (!db) throw new Error('IndexedDB is unavailable.');
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const [key, entry] of entries) store.put(entry, key);
    await transactionDone(tx);
  }

  // Copies every legacy cache entry still in localStorage into IndexedDB in one
  // transaction, then frees it from localStorage (retired formats are just freed). A
  // failed copy leaves the entries for the next visit to retry; without IndexedDB at
  // all they're freed anyway, since nothing reads caches from localStorage any more.
  async function migrateLegacyCaches(): Promise<void> {
    // A browser that blocks localStorage throws here; `persisted` ignores the failure.
    const storage = env.storage();
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key !== null) keys.push(key);
    }
    const retired = keys.filter((k) => RETIRED_CACHE_PREFIXES.some((p) => k.startsWith(p)));
    const legacy: [string, CacheEntry<unknown>][] = [];
    for (const key of keys) {
      if (!LEGACY_CACHE_PREFIXES.some((p) => key.startsWith(p))) continue;
      try {
        const entry = JSON.parse(storage.getItem(key) ?? '') as CacheEntry<unknown>;
        if (entry && typeof entry.savedAt === 'number' && 'value' in entry) {
          legacy.push([key, entry]);
        } else {
          retired.push(key);
        }
      } catch {
        retired.push(key);
      }
    }
    removeAll(retired, storage);
    if (!legacy.length) return;
    const db = await openDb();
    if (db) await writeEntries(legacy);
    removeAll(
      legacy.map(([key]) => key),
      storage,
    );
  }

  // Get-or-compute: a fresh-enough cached value resolves without calling `compute`;
  // otherwise `compute` runs and its result is saved (a failed save is ignored).
  // The legacy migration runs once first, so nothing already cached is refetched.
  // `ttlMs` may depend on the cached value (one that can no longer change can be kept
  // longer); `savedAt` is when the value was computed, so a caller can tell how
  // old a cached one is.
  async function persistedEntry<T>(
    key: string,
    ttlMs: number | ((value: T) => number),
    compute: () => Promise<T>,
  ): Promise<CacheEntry<T>> {
    await (legacyMigration ??= migrateLegacyCaches().catch(() => {}));
    const cached = await readEntry<T>(key);
    if (cached) {
      const ttl = typeof ttlMs === 'function' ? ttlMs(cached.value) : ttlMs;
      if (env.now() - cached.savedAt <= ttl) return cached;
    }
    const value = await compute();
    const entry = { value, savedAt: env.now() };
    const save = writeEntries([[key, entry]]).catch(() => {});
    saves = Promise.all([saves, save]).then(() => {});
    return entry;
  }

  async function persisted<T>(key: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
    return (await persistedEntry(key, ttlMs, compute)).value;
  }

  return { persisted, persistedEntry, savesSettled: () => saves };
}

export const { persisted, persistedEntry } = createIdbCache({
  indexedDB: () => globalThis.indexedDB,
  storage: () => localStorage,
  now: () => Date.now(),
});

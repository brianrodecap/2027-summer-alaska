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

interface Entry<T> {
  value: T;
  savedAt: number;
}

function open(version?: number): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    const request =
      version === undefined ? indexedDB.open(DB_NAME) : indexedDB.open(DB_NAME, version);
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

let dbPromise: Promise<IDBDatabase | null> | null = null;

// Opens at whatever version exists (creating it, store included, the first time). A
// database that exists but lacks the store — created by anything else that opened
// this name first — is reopened one version up so the upgrade can add it, rather than
// leaving the cache silently broken in that browser for good.
function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= (async () => {
    try {
      if (typeof indexedDB === 'undefined') return null;
      let db = await open();
      if (db && !db.objectStoreNames.contains(STORE)) {
        const next = db.version + 1;
        db.close();
        db = await open(next);
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

// Test-only: forget the open connection so each test starts from a fresh database.
export function resetIdbCacheForTests(): void {
  dbPromise = null;
  legacyMigration = null;
}

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

async function readEntry<T>(key: string): Promise<Entry<T> | null> {
  const db = await openDb();
  if (!db) return null;
  try {
    const entry = await requestResult(db.transaction(STORE).objectStore(STORE).get(key));
    return (entry as Entry<T> | undefined) ?? null;
  } catch {
    return null;
  }
}

async function writeEntries(entries: [string, Entry<unknown>][]): Promise<void> {
  const db = await openDb();
  if (!db) throw new Error('IndexedDB is unavailable.');
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  for (const [key, entry] of entries) store.put(entry, key);
  await transactionDone(tx);
}

// Get-or-compute: a fresh-enough cached value resolves without calling `compute`;
// otherwise `compute` runs and its result is saved (a failed save is ignored).
export async function persisted<T>(
  key: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  await legacyCachesMigrated();
  const cached = await readEntry<T>(key);
  if (cached && Date.now() - cached.savedAt <= ttlMs) return cached.value;
  const value = await compute();
  writeEntries([[key, { value, savedAt: Date.now() }]]).catch(() => {});
  return value;
}

// ---------- the one-time move out of localStorage ----------

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

let legacyMigration: Promise<void> | null = null;

// Runs once per visit, before the first cache read, so nothing already cached gets
// refetched — see migrateLegacyCaches.
function legacyCachesMigrated(): Promise<void> {
  legacyMigration ??= migrateLegacyCaches().catch(() => {});
  return legacyMigration;
}

function removeAll(keys: Iterable<string>): void {
  for (const key of keys) {
    try {
      localStorage.removeItem(key);
    } catch {
      // Blocked storage; nothing more to do.
    }
  }
}

// Copies every legacy cache entry still in localStorage into IndexedDB in one
// transaction, then frees it from localStorage (retired formats are just freed). A
// failed copy leaves the entries for the next visit to retry; without IndexedDB at
// all they're freed anyway, since nothing reads caches from localStorage any more.
export async function migrateLegacyCaches(): Promise<void> {
  let keys: string[];
  try {
    keys = Object.keys(localStorage);
  } catch {
    return;
  }
  const retired = keys.filter((k) => RETIRED_CACHE_PREFIXES.some((p) => k.startsWith(p)));
  const legacy: [string, Entry<unknown>][] = [];
  for (const key of keys) {
    if (!LEGACY_CACHE_PREFIXES.some((p) => key.startsWith(p))) continue;
    try {
      const entry = JSON.parse(localStorage.getItem(key) ?? '') as Entry<unknown>;
      if (entry && typeof entry.savedAt === 'number' && 'value' in entry) legacy.push([key, entry]);
      else retired.push(key);
    } catch {
      retired.push(key);
    }
  }
  removeAll(retired);
  if (!legacy.length) return;
  const db = await openDb();
  if (db) await writeEntries(legacy);
  removeAll(legacy.map(([key]) => key));
}

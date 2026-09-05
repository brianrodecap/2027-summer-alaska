// Shared "cache by key, store the promise" helpers, used everywhere a live
// lookup is worth deduping within a page load (memoizeAsync) and/or across
// visits via localStorage (persisted) — weather.ts's place/climate lookups,
// placeCoordinates.ts's own coordinate lookup, and elevation.ts all share
// this rather than each hand-rolling the same pattern.

// Get-or-compute-and-cache the in-flight/resolved promise for `key` — a
// repeat lookup within one page load never re-fires the underlying fetch.
export function memoizeAsync<K, V>(
  cache: Map<K, Promise<V>>,
  key: K,
  compute: () => Promise<V>,
): Promise<V> {
  if (!cache.has(key)) cache.set(key, compute());
  return cache.get(key) as Promise<V>;
}

// Wraps localStorage so a lookup already resolved on a previous visit
// doesn't cost a network round-trip at all, not even a cached-but-still-async
// one. Swallows quota/availability errors (Safari private browsing throws on
// write) since this is purely an optimization: losing it just means falling
// back to the in-memory-only behavior for that session.
function loadPersisted<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { value, savedAt } = JSON.parse(raw) as { value: T; savedAt: number };
    if (Date.now() - savedAt > maxAgeMs) return null;
    return value;
  } catch {
    return null;
  }
}

function savePersisted<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now() }));
  } catch {
    // best-effort — see loadPersisted's note above
  }
}

// Layers loadPersisted/savePersisted around a compute function — for a
// lookup that's also worth surviving a page reload, not just deduping
// within one.
export function persisted<T>(
  storageKey: string,
  ttlMs: number,
  compute: () => Promise<T>,
): Promise<T> {
  const cached = loadPersisted<T>(storageKey, ttlMs);
  if (cached !== null) return Promise.resolve(cached);
  return compute().then((value) => {
    savePersisted(storageKey, value);
    return value;
  });
}

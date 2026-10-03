// The shared "cache by key, store the promise" helper, used everywhere a live
// lookup is worth deduping within a page load — weather.ts, placeCoordinates.ts,
// elevation.ts, holidays.ts and directions.ts all share it rather than each
// hand-rolling the same pattern. Caching across visits is idbCache.ts's `persisted`.

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

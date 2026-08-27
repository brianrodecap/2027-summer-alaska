import { useEffect, useRef, useState } from 'react';

interface KeyedAsyncResult<K, V> {
  key: K | null;
  value: V | null;
  failed: boolean;
}

export interface KeyedAsyncState<V> {
  value: V | null;
  loading: boolean;
  failed: boolean;
}

// Generic "key the last async result by what it was fetched for" hook —
// shared by usePlaceDetails and useDayWeather, both of which look up the
// same key (a place id, or a composite of several place ids + a date) more
// than once across a page session and need to avoid a stale-render flicker
// when `key` changes before the previous fetch has resolved. `value`/
// `loading`/`failed` are derived by comparing the last-resolved `key`
// against the current one at render time, rather than trusting whichever
// fetch happens to resolve last. `fetch` is read through a ref rather than
// listed as a dependency, so a fresh closure every render doesn't retrigger
// the effect — only a real change to `key`/`shouldFetch` does.
export function useKeyedAsync<K, V>(
  key: K | null,
  shouldFetch: boolean,
  fetch: (key: K) => Promise<V>,
): KeyedAsyncState<V> {
  const [result, setResult] = useState<KeyedAsyncResult<K, V>>({
    key: null,
    value: null,
    failed: false,
  });
  const fetchRef = useRef(fetch);
  useEffect(() => {
    fetchRef.current = fetch;
  });

  useEffect(() => {
    if (!shouldFetch || key === null) return;
    let cancelled = false;
    fetchRef
      .current(key)
      .then((value) => {
        if (!cancelled) setResult({ key, value, failed: false });
      })
      .catch(() => {
        if (!cancelled) setResult({ key, value: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [key, shouldFetch]);

  const loading = shouldFetch && result.key !== key;
  const value = result.key === key ? result.value : null;
  const failed = result.key === key && result.failed;

  return { value, loading, failed };
}

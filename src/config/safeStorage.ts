// localStorage reads and writes that never throw. Private windows, blocked site
// data, and a full quota all make localStorage throw, and every caller of this
// module treats persistence as best-effort: a failed read is "nothing stored"
// and a failed write just means the value doesn't survive the visit.
//
// Writes that must not silently fail (saved edits, the API key) call
// `storage.setItem` directly instead, so a failure surfaces. localStorage holds only
// user data like those — lookup caches live in IndexedDB (src/model/idbCache.ts),
// so they can't fill the quota out from under it.
export function safeGetItem(key: string, storage: Storage = localStorage): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string, storage: Storage = localStorage): void {
  try {
    storage.setItem(key, value);
  } catch {
    // Not persisted; callers keep their in-memory value for this visit.
  }
}

export function safeRemoveItem(key: string, storage: Storage = localStorage): void {
  try {
    storage.removeItem(key);
  } catch {
    // Blocked storage: nothing stored to remove.
  }
}

// A stored JSON value, or `fallback` when it's missing, unreadable, or fails `guard` —
// so corrupt or old-shaped data starts fresh instead of breaking the caller.
export function readJson<T, F>(
  key: string,
  guard: (value: unknown) => value is T,
  fallback: F,
  storage: Storage = localStorage,
): T | F {
  const raw = safeGetItem(key, storage);
  if (!raw) return fallback;
  try {
    const parsed: unknown = JSON.parse(raw);
    return guard(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

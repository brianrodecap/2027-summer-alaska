// localStorage reads and writes that never throw. Private windows, blocked site
// data, and a full quota all make localStorage throw, and every caller of this
// module treats persistence as best-effort: a failed read is "nothing stored"
// and a failed write just means the value doesn't survive the visit.
//
// src/config/aiKey.ts reads through safeGetItem but deliberately writes with raw
// localStorage, so a pasted API key that fails to save surfaces instead of
// looking saved.
export function safeGetItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function safeSetItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Not persisted; callers keep their in-memory value for this visit.
  }
}

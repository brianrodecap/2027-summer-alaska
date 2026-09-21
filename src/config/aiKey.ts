import { safeGetItem } from './safeStorage';

// Anthropic API key shared by the AI chat and document-import features
// (src/model/askAI.ts, src/model/documentImport.ts).
// Unlike src/config/places.ts's Google key, this one is NEVER hardcoded or committed:
// an Anthropic key has no HTTP-referrer restriction mechanism, so baking one into the
// bundle would let anyone visiting the site drain the account. Instead it's pasted once
// per browser by whoever's using the import feature and kept in localStorage only — it
// is plaintext-readable by any script running on this page (including browser
// extensions), so this is a convenience for a single trusted user, not a secret store.
// Reads never throw (a blocked localStorage just means no key is stored yet), but
// writes deliberately do: a pasted key that silently failed to save would look saved.
const STORAGE_KEY = 'aiApiKey';

export function getStoredApiKey(): string | null {
  return safeGetItem(STORAGE_KEY);
}

export function setStoredApiKey(key: string): void {
  localStorage.setItem(STORAGE_KEY, key);
}

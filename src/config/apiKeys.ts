import { safeGetItem } from './safeStorage';

// The two API keys this static site calls out with. Both are entered in Settings
// and kept in this browser's localStorage, never hardcoded or committed. Each is
// read where its request goes out (anthropicClient.ts; googleApiFetch.ts,
// placePhotos.ts and the day map's APIProvider), so nothing between the UI and
// the request carries a key; hasGoogleApiKey only says whether there is one.
//
// localStorage is plaintext-readable by any script running on this page (including
// browser extensions), so this is a convenience for trusted users, not a secret
// store. Reads never throw (a blocked localStorage just means no key is stored
// yet), but writes deliberately do: a pasted key that silently failed to save would
// look saved. A key entered this visit is held in memory first, so it's the one
// used even when saving it fails.
// One key's reader and writer. The app uses the two below; another instance for the
// same key wouldn't share this visit's unsaved key, so only tests make their own.
export function storedKey(storageKey: string, storage?: Storage) {
  let entered: string | null = null;
  return {
    // '' when no key is set.
    get: (): string => entered ?? safeGetItem(storageKey, storage) ?? '',
    // Throws if the key can't be saved (blocked storage, or a full quota); it's
    // still used for the rest of this visit.
    set: (key: string): void => {
      entered = key;
      (storage ?? localStorage).setItem(storageKey, key);
    },
  };
}

// Anthropic: the AI chat and document import (src/model/askAI.ts,
// src/model/proposalImport.ts). An Anthropic key has no HTTP-referrer
// restriction, so it must never ship in the bundle.
const anthropic = storedKey('aiApiKey');
export const getAnthropicApiKey = anthropic.get;
export const setAnthropicApiKey = anthropic.set;

// Google: Places, Routes, Weather, Elevation and photo lookups, plus the day
// map's Maps JavaScript API. In Cloud Console, enable those APIs on the key,
// restrict it by HTTP referrer to this site's GitHub Pages domain and
// localhost, and cap its daily quota.
// Lookups read it when they first render, so Settings reloads the page after
// saving a new one.
const google = storedKey('googleApiKey');
export const getGoogleApiKey = google.get;
export const setGoogleApiKey = google.set;

// Whether Google lookups can run at all.
export function hasGoogleApiKey(): boolean {
  return Boolean(getGoogleApiKey());
}

export interface ApiKeys {
  anthropic: string;
  google: string;
}
type StoredKey = ReturnType<typeof storedKey>;

const trimmed = (keys: ApiKeys): ApiKeys => ({
  anthropic: keys.anthropic.trim(),
  google: keys.google.trim(),
});

// Whether Settings has anything to save: a key that differs, once trimmed.
export function keysChanged(entered: ApiKeys, saved: ApiKeys): boolean {
  const next = trimmed(entered);
  return next.anthropic !== saved.anthropic || next.google !== saved.google;
}

// False when the browser refused the write; the key is still held for this visit.
function trySave(save: () => void): boolean {
  try {
    save();
    return true;
  } catch {
    return false;
  }
}

// Saves the keys entered in Settings. Only changed keys are written, each on its
// own, so one failed write can't drop the other key. Google lookups are gated when
// each component first renders and the map's script loads once, so a new Google
// key takes effect on a fresh page: `reload`. A reload would lose an unsaved
// Anthropic key, so it waits for a clean save; otherwise `error` says what didn't.
export function saveApiKeys(
  entered: ApiKeys,
  saved: ApiKeys,
  stores: { anthropic: StoredKey; google: StoredKey } = { anthropic, google },
): { reload: boolean; saved: ApiKeys; error: string | null } {
  const next = trimmed(entered);
  const googleChanged = next.google !== saved.google;
  const anthropicSaved =
    next.anthropic === saved.anthropic || trySave(() => stores.anthropic.set(next.anthropic));
  const googleSaved = !googleChanged || trySave(() => stores.google.set(next.google));
  const reload = googleChanged && googleSaved && anthropicSaved;
  return {
    reload,
    saved: next,
    error:
      anthropicSaved && googleSaved
        ? null
        : [
            "Couldn't save in this browser, which has storage blocked or full.",
            !anthropicSaved && 'The Anthropic key works only until you leave.',
            !googleSaved && 'The new Google key needs saved storage to take effect.',
            googleChanged && googleSaved && 'Reload the page to start using the new Google key.',
          ]
            .filter(Boolean)
            .join(' '),
  };
}

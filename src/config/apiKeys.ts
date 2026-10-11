import { safeGetItem } from './safeStorage';

// The two API keys this static site calls out with. Both are entered in Settings
// and kept in this browser's localStorage, never hardcoded or committed. Each has
// one reader here, called at the edge where the request goes out
// (anthropicClient.ts; googleApiFetch.ts, placePhotos.ts and the day map's
// APIProvider), so nothing between the UI and the request carries a key.
//
// localStorage is plaintext-readable by any script running on this page (including
// browser extensions), so this is a convenience for trusted users, not a secret
// store. Reads never throw (a blocked localStorage just means no key is stored
// yet), but writes deliberately do: a pasted key that silently failed to save would
// look saved. A key entered this visit is held in memory first, so it's the one
// used even when saving it fails.
function storedKey(storageKey: string) {
  let entered: string | null = null;
  return {
    // '' when no key is set.
    get: (): string => entered ?? safeGetItem(storageKey) ?? '',
    // Throws if the key can't be saved (blocked storage, or a full quota); it's
    // still used for the rest of this visit.
    set: (key: string): void => {
      entered = key;
      localStorage.setItem(storageKey, key);
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

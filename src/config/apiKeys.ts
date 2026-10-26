import { safeGetItem } from './safeStorage';

// The API keys this static site calls out with. Each is entered in Settings and
// kept in this browser's localStorage, never hardcoded or committed. Each is read
// where its request goes out (anthropicClient.ts; googleApiFetch.ts, placePhotos.ts
// and the day map's APIProvider; airlabsFlights.ts and
// aviationstackFlights.ts for the flight sources), so nothing between the UI and
// the request carries a key; hasGoogleApiKey only says whether there is one.
//
// localStorage is plaintext-readable by any script running on this page (including
// browser extensions), so this is a convenience for trusted users, not a secret
// store. Reads never throw (a blocked localStorage just means no key is stored
// yet), but writes deliberately do: a pasted key that silently failed to save would
// look saved. A key entered this visit is held in memory first, so it's the one
// used even when saving it fails.
// One key's reader and writer. The app uses those in KEYS below; another instance for the
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

// Each key Settings saves: where it's stored, what Settings calls it and says it's
// for, and whether a new one needs a page reload to take effect.
const KEYS = {
  // Anthropic: the AI chat and document import (src/model/askAI.ts,
  // src/model/proposalImport.ts). An Anthropic key has no HTTP-referrer
  // restriction, so it must never ship in the bundle. Read per request.
  anthropic: {
    store: storedKey('aiApiKey'),
    label: 'Anthropic',
    help: 'For the assistant and document import. Sent only to api.anthropic.com.',
    reload: false,
  },
  // Google: Places, Routes, Weather, Elevation and photo lookups, plus the day
  // map's Maps JavaScript API. In Cloud Console, enable those APIs on the key,
  // restrict it by HTTP referrer to this site's GitHub Pages domain and
  // localhost, and cap its daily quota. Lookups read it when they first render
  // and the map's script loads once, so a new one takes effect on a fresh page.
  google: {
    store: storedKey('googleApiKey'),
    label: 'Google',
    help: 'For maps, place details, photos and weather. Sent only to Google.',
    reload: true,
  },
  // AirLabs: live flight status, asked first. The key goes in the request URL (over
  // HTTPS, CORS open) and has no referrer restriction, so, like Anthropic's, it must
  // never ship in the bundle. Read per request.
  airlabs: {
    store: storedKey('airlabsApiKey'),
    label: 'AirLabs',
    help: 'For live flight status on the day you fly. Sent only to airlabs.co.',
    reload: false,
  },
  // AviationStack: live flight status, asked when AirLabs has no answer or no key.
  // The key goes in the request URL (over HTTPS;
  // a free-plan key was checked to work on https://api.aviationstack.com, with CORS
  // open) and has no referrer restriction, so, like Anthropic's, it must never ship
  // in the bundle. Read per request.
  aviationstack: {
    store: storedKey('aviationstackApiKey'),
    label: 'AviationStack',
    help: 'Backup for live flight status. Sent only to api.aviationstack.com.',
    reload: false,
  },
};

export type KeyName = keyof typeof KEYS;
export type ApiKeys = Record<KeyName, string>;
type StoredKey = ReturnType<typeof storedKey>;

export const API_KEY_NAMES = Object.keys(KEYS) as KeyName[];
export const apiKeyLabel = (name: KeyName): string => KEYS[name].label;
export const apiKeyHelp = (name: KeyName): string => KEYS[name].help;
export const keyNeedsReload = (name: KeyName): boolean => KEYS[name].reload;

export const getAnthropicApiKey = KEYS.anthropic.store.get;
export const setAnthropicApiKey = KEYS.anthropic.store.set;
export const getGoogleApiKey = KEYS.google.store.get;
export const setGoogleApiKey = KEYS.google.store.set;
export const getAirlabsApiKey = KEYS.airlabs.store.get;
export const getAviationstackApiKey = KEYS.aviationstack.store.get;

// Whether Google lookups can run at all.
export function hasGoogleApiKey(): boolean {
  return Boolean(getGoogleApiKey());
}

// Every key as Settings has it saved.
export function savedApiKeys(): ApiKeys {
  return mapKeys((name) => KEYS[name].store.get());
}

function mapKeys<T>(value: (name: KeyName) => T): Record<KeyName, T> {
  return Object.fromEntries(API_KEY_NAMES.map((name) => [name, value(name)])) as Record<KeyName, T>;
}

// "Google" / "Anthropic and AviationStack" / "A, B, and C"; `or` for a choice.
export function listKeys(names: KeyName[], type: 'conjunction' | 'disjunction' = 'conjunction') {
  return new Intl.ListFormat('en', { type }).format(names.map(apiKeyLabel));
}

// Whether Settings has anything to save: a key that differs, once trimmed.
export function keysChanged(entered: ApiKeys, saved: ApiKeys): boolean {
  return API_KEY_NAMES.some((name) => entered[name].trim() !== saved[name]);
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

// "Google key" / "Anthropic and AviationStack keys", with a verb that agrees.
function keysPhrase(names: KeyName[], verbs: [string, string] = ['', '']): string {
  const many = names.length > 1;
  const verb = many ? verbs[1] : verbs[0];
  return `${listKeys(names)} ${many ? 'keys' : 'key'}${verb && ` ${verb}`}`;
}

// Saves the keys entered in Settings. Only changed keys are written, each on its
// own, so one failed write can't drop another key. A new key that needs a reload
// asks for one (`reload`), but only after a clean save: a reload would lose a key
// held only for this visit. Otherwise `error` says what didn't save.
export function saveApiKeys(
  entered: ApiKeys,
  saved: ApiKeys,
  stores: Record<KeyName, StoredKey> = mapKeys((name) => KEYS[name].store),
): { reload: boolean; saved: ApiKeys; error: string | null } {
  const next = mapKeys((name) => entered[name].trim());
  const changed = API_KEY_NAMES.filter((name) => next[name] !== saved[name]);
  const failed = changed.filter((name) => !trySave(() => stores[name].set(next[name])));
  const unsaved = failed.filter((name) => !keyNeedsReload(name));
  const unsavedReload = failed.filter(keyNeedsReload);
  const savedReload = changed.filter((name) => keyNeedsReload(name) && !failed.includes(name));
  return {
    reload: savedReload.length > 0 && !failed.length,
    saved: next,
    error: !failed.length
      ? null
      : [
          "Couldn't save in this browser, which has storage blocked or full.",
          unsaved.length && `The ${keysPhrase(unsaved, ['works', 'work'])} only until you leave.`,
          unsavedReload.length &&
            `The new ${keysPhrase(unsavedReload, ['needs', 'need'])} saved storage to take effect.`,
          savedReload.length &&
            `Reload the page to start using the new ${keysPhrase(savedReload)}.`,
        ]
          .filter(Boolean)
          .join(' '),
  };
}

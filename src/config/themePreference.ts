import { safeGetItem, safeSetItem } from './safeStorage';

// The user's chosen color mode, kept in localStorage per browser (same
// no-backend storage approach as aiKey.ts, minus the secrecy concerns).
// 'system' defers to the OS-level prefers-color-scheme setting.
const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

const STORAGE_KEY = 'themePreference';

// This site shipped dark-only, so an unset preference stays dark rather than
// silently flipping existing visitors to whatever their OS prefers.
export const DEFAULT_THEME_PREFERENCE: ThemePreference = 'dark';

function isThemePreference(value: string | null): value is ThemePreference {
  return (THEME_PREFERENCES as readonly (string | null)[]).includes(value);
}

export function getStoredThemePreference(): ThemePreference {
  const stored = safeGetItem(STORAGE_KEY);
  return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE;
}

export function setStoredThemePreference(preference: ThemePreference): void {
  safeSetItem(STORAGE_KEY, preference);
}

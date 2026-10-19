import { describe, expect, it } from 'vitest';

import { BlockedStorage, MemoryStorage } from '../test/memoryStorage';
import {
  DEFAULT_THEME_PREFERENCE,
  getStoredThemePreference,
  setStoredThemePreference,
} from './themePreference';

describe('themePreference storage', () => {
  it('defaults when nothing is stored', () => {
    expect(getStoredThemePreference(new MemoryStorage())).toBe(DEFAULT_THEME_PREFERENCE);
  });

  it('round-trips each valid preference', () => {
    const storage = new MemoryStorage();
    for (const pref of ['light', 'dark', 'system'] as const) {
      setStoredThemePreference(pref, storage);
      expect(getStoredThemePreference(storage)).toBe(pref);
    }
  });

  it('falls back to the default for an unrecognized stored value', () => {
    const storage = new MemoryStorage({ themePreference: 'sepia' });
    expect(getStoredThemePreference(storage)).toBe(DEFAULT_THEME_PREFERENCE);
  });

  it('does not throw when localStorage is unavailable', () => {
    const blocked = new BlockedStorage();
    expect(getStoredThemePreference(blocked)).toBe(DEFAULT_THEME_PREFERENCE);
    expect(() => setStoredThemePreference('light', blocked)).not.toThrow();
  });
});

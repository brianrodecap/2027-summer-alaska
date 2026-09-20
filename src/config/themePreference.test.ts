import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DEFAULT_THEME_PREFERENCE,
  getStoredThemePreference,
  setStoredThemePreference,
} from './themePreference';

describe('themePreference storage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('defaults when nothing is stored', () => {
    expect(getStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
  });

  it('round-trips each valid preference', () => {
    for (const pref of ['light', 'dark', 'system'] as const) {
      setStoredThemePreference(pref);
      expect(getStoredThemePreference()).toBe(pref);
    }
  });

  it('falls back to the default for an unrecognized stored value', () => {
    localStorage.setItem('themePreference', 'sepia');
    expect(getStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(getStoredThemePreference()).toBe(DEFAULT_THEME_PREFERENCE);
    expect(() => setStoredThemePreference('light')).not.toThrow();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

import { safeGetItem, safeSetItem } from './safeStorage';

describe('safeStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('returns null for a key that was never stored', () => {
    expect(safeGetItem('missing')).toBeNull();
  });

  it('round-trips a stored value', () => {
    safeSetItem('k', 'v');
    expect(safeGetItem('k')).toBe('v');
  });

  it('does not throw when localStorage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(safeGetItem('k')).toBeNull();
    expect(() => safeSetItem('k', 'v')).not.toThrow();
  });
});

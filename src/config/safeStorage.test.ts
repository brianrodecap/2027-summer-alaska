import { afterEach, describe, expect, it, vi } from 'vitest';

import { readJson, safeGetItem, safeRemoveItem, safeSetItem } from './safeStorage';

describe('safeStorage', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  it('returns null for a key that was never stored', () => {
    expect(safeGetItem('missing')).toBeNull();
  });

  it('round-trips a stored value, and removes it', () => {
    safeSetItem('k', 'v');
    expect(safeGetItem('k')).toBe('v');
    safeRemoveItem('k');
    expect(safeGetItem('k')).toBeNull();
  });

  it('does not throw when localStorage is unavailable', () => {
    for (const method of ['getItem', 'setItem', 'removeItem'] as const) {
      vi.spyOn(Storage.prototype, method).mockImplementation(() => {
        throw new Error('blocked');
      });
    }
    expect(safeGetItem('k')).toBeNull();
    expect(() => safeSetItem('k', 'v')).not.toThrow();
    expect(() => safeRemoveItem('k')).not.toThrow();
  });
});

describe('readJson', () => {
  afterEach(() => localStorage.clear());
  const isNumbers = (v: unknown): v is number[] => Array.isArray(v);

  it('returns the stored value when it passes the guard', () => {
    localStorage.setItem('k', '[1,2]');
    expect(readJson('k', isNumbers, null)).toEqual([1, 2]);
  });

  it('falls back when missing, corrupt, or the wrong shape', () => {
    expect(readJson('missing', isNumbers, null)).toBeNull();
    localStorage.setItem('corrupt', '{not json');
    expect(readJson('corrupt', isNumbers, null)).toBeNull();
    localStorage.setItem('shape', '{"a":1}');
    expect(readJson('shape', isNumbers, null)).toBeNull();
  });
});

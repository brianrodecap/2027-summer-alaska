import { describe, expect, it } from 'vitest';

import { BlockedStorage, MemoryStorage } from '../test/memoryStorage';
import { readJson, safeGetItem, safeRemoveItem, safeSetItem } from './safeStorage';

describe('safeStorage', () => {
  it('returns null for a key that was never stored', () => {
    expect(safeGetItem('missing', new MemoryStorage())).toBeNull();
  });

  it('round-trips a stored value, and removes it', () => {
    const storage = new MemoryStorage();
    safeSetItem('k', 'v', storage);
    expect(safeGetItem('k', storage)).toBe('v');
    safeRemoveItem('k', storage);
    expect(safeGetItem('k', storage)).toBeNull();
  });

  it('does not throw when localStorage is unavailable', () => {
    const blocked = new BlockedStorage();
    expect(safeGetItem('k', blocked)).toBeNull();
    expect(() => safeSetItem('k', 'v', blocked)).not.toThrow();
    expect(() => safeRemoveItem('k', blocked)).not.toThrow();
  });
});

describe('readJson', () => {
  const isNumbers = (v: unknown): v is number[] => Array.isArray(v);

  it('returns the stored value when it passes the guard', () => {
    expect(readJson('k', isNumbers, null, new MemoryStorage({ k: '[1,2]' }))).toEqual([1, 2]);
  });

  it('falls back when missing, corrupt, or the wrong shape', () => {
    const storage = new MemoryStorage({ corrupt: '{not json', shape: '{"a":1}' });
    expect(readJson('missing', isNumbers, null, storage)).toBeNull();
    expect(readJson('corrupt', isNumbers, null, storage)).toBeNull();
    expect(readJson('shape', isNumbers, null, storage)).toBeNull();
  });
});

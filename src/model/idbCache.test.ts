import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { migrateLegacyCaches, persisted, resetIdbCacheForTests } from './idbCache';

// jsdom has no IndexedDB, so each test gets a fresh in-memory one.
beforeEach(() => {
  vi.stubGlobal('indexedDB', new IDBFactory());
  resetIdbCacheForTests();
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const entry = (value: unknown, savedAt = Date.now()) => JSON.stringify({ value, savedAt });

describe('persisted', () => {
  it('computes once, then serves the cached value', async () => {
    const compute = vi.fn(async () => ({ minutes: 12 }));
    expect(await persisted('route:v2:a', Infinity, compute)).toEqual({ minutes: 12 });
    // Let the fire-and-forget save land before reading again.
    await new Promise((r) => setTimeout(r, 0));
    expect(await persisted('route:v2:a', Infinity, compute)).toEqual({ minutes: 12 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('recomputes an entry older than the TTL', async () => {
    const compute = vi.fn(async () => 'fresh');
    await persisted('k', Infinity, async () => 'old');
    await new Promise((r) => setTimeout(r, 5));
    expect(await persisted('k', 1, compute)).toBe('fresh');
  });

  it('repairs a database that exists without its store', async () => {
    // Something else opened the name first, creating an empty version-1 database.
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('itinerary-cache');
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    const compute = vi.fn(async () => 'v');
    await persisted('k', Infinity, compute);
    await new Promise((r) => setTimeout(r, 0));
    await persisted('k', Infinity, compute);
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it('still answers, uncached, when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    resetIdbCacheForTests();
    const compute = vi.fn(async () => 'v');
    expect(await persisted('k', Infinity, compute)).toBe('v');
    expect(await persisted('k', Infinity, compute)).toBe('v');
    expect(compute).toHaveBeenCalledTimes(2);
  });
});

describe('migrateLegacyCaches', () => {
  it('moves legacy cache entries into IndexedDB and frees localStorage', async () => {
    localStorage.setItem('route:v2:a', entry({ travel: { minutes: 5 } }));
    localStorage.setItem('holidays:v1:US-2027', entry([]));
    localStorage.setItem('route:v2:junk', 'not json');
    localStorage.setItem('driving-path:retired', 'x');
    localStorage.setItem('itinerary.changes.v1/trip', '[]');

    await migrateLegacyCaches();

    expect(localStorage.getItem('route:v2:a')).toBeNull();
    expect(localStorage.getItem('holidays:v1:US-2027')).toBeNull();
    // Unreadable cache entries and retired formats are just freed.
    expect(localStorage.getItem('route:v2:junk')).toBeNull();
    expect(localStorage.getItem('driving-path:retired')).toBeNull();
    // Not a cache: left alone.
    expect(localStorage.getItem('itinerary.changes.v1/trip')).toBe('[]');

    const compute = vi.fn();
    expect(await persisted('route:v2:a', Infinity, compute)).toEqual({ travel: { minutes: 5 } });
    expect(compute).not.toHaveBeenCalled();
  });

  it('runs before the first read, so an already-cached lookup is not refetched', async () => {
    localStorage.setItem('place-coords:v1:p', entry({ lat: 1, lng: 2 }));
    const compute = vi.fn();
    expect(await persisted('place-coords:v1:p', Infinity, compute)).toEqual({ lat: 1, lng: 2 });
    expect(compute).not.toHaveBeenCalled();
  });

  it('keeps the original savedAt, so TTLs carry over', async () => {
    localStorage.setItem('weather-climate:v3:old', entry('stale', 1));
    expect(await persisted('weather-climate:v3:old', 1000, async () => 'refetched')).toBe(
      'refetched',
    );
  });

  it('still frees localStorage when IndexedDB is unavailable', async () => {
    vi.stubGlobal('indexedDB', undefined);
    resetIdbCacheForTests();
    localStorage.setItem('route:v2:a', entry('x'));
    await migrateLegacyCaches();
    expect(localStorage.getItem('route:v2:a')).toBeNull();
  });
});

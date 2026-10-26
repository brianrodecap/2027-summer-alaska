import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';

import { MemoryStorage } from '../test/memoryStorage';
import { createIdbCache } from './idbCache';

// A cache over a fresh in-memory IndexedDB (none when `indexedDB` is null) and
// `storage`, on a clock that `advance` moves on.
function cacheOver({
  storage = new MemoryStorage(),
  indexedDB = new IDBFactory() as IDBFactory | null,
} = {}) {
  let time = 1_000_000;
  const cache = createIdbCache({
    indexedDB: () => indexedDB ?? undefined,
    storage: () => storage,
    now: () => time,
  });
  return { ...cache, advance: (ms: number) => (time += ms) };
}

// A compute that answers `value` and counts its calls.
function computing<T>(value: T) {
  const calls = { count: 0 };
  const compute = async () => {
    calls.count++;
    return value;
  };
  return { calls, compute };
}

const entry = (value: unknown, savedAt: number) => JSON.stringify({ value, savedAt });

describe('persisted', () => {
  it('computes once, then serves the cached value', async () => {
    const { persisted, savesSettled } = cacheOver();
    const { calls, compute } = computing({ minutes: 12 });
    expect(await persisted('route:v2:a', Infinity, compute)).toEqual({ minutes: 12 });
    await savesSettled();
    expect(await persisted('route:v2:a', Infinity, compute)).toEqual({ minutes: 12 });
    expect(calls.count).toBe(1);
  });

  it('serves an entry within its TTL and recomputes one older than it', async () => {
    const { persisted, savesSettled, advance } = cacheOver();
    await persisted('k', Infinity, async () => 'cached');
    await savesSettled();
    advance(60_000);
    expect(await persisted('k', 120_000, async () => 'fresh')).toBe('cached');
    expect(await persisted('k', 30_000, async () => 'fresh')).toBe('fresh');
  });

  it('says when the value it serves was computed', async () => {
    const { persistedEntry, savesSettled, advance } = cacheOver();
    expect(await persistedEntry('k', Infinity, async () => 'v')).toEqual({
      value: 'v',
      savedAt: 1_000_000,
    });
    await savesSettled();
    advance(60_000);
    expect(await persistedEntry('k', Infinity, async () => 'fresh')).toEqual({
      value: 'v',
      savedAt: 1_000_000,
    });
  });

  it('lets the cached value choose how long it is kept', async () => {
    const { persistedEntry, savesSettled, advance } = cacheOver();
    const ttl = (value: string) => (value === 'final' ? Infinity : 1000);
    await persistedEntry('final', ttl, async () => 'final');
    await persistedEntry('open', ttl, async () => 'open');
    await savesSettled();
    advance(60_000);
    expect((await persistedEntry('final', ttl, async () => 'new')).value).toBe('final');
    expect((await persistedEntry('open', ttl, async () => 'new')).value).toBe('new');
  });

  it('repairs a database that exists without its store', async () => {
    const indexedDB = new IDBFactory();
    // Something else opened the name first, creating an empty version-1 database.
    await new Promise<void>((resolve) => {
      const request = indexedDB.open('itinerary-cache');
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    const { persisted, savesSettled } = cacheOver({ indexedDB });
    const { calls, compute } = computing('v');
    await persisted('k', Infinity, compute);
    await savesSettled();
    await persisted('k', Infinity, compute);
    expect(calls.count).toBe(1);
  });

  it('still answers, uncached, when IndexedDB is unavailable', async () => {
    const { persisted } = cacheOver({ indexedDB: null });
    const { calls, compute } = computing('v');
    expect(await persisted('k', Infinity, compute)).toBe('v');
    expect(await persisted('k', Infinity, compute)).toBe('v');
    expect(calls.count).toBe(2);
  });
});

describe('migrateLegacyCaches', () => {
  it('moves legacy cache entries into IndexedDB and frees localStorage', async () => {
    const storage = new MemoryStorage({
      'route:v2:a': entry({ travel: { minutes: 5 } }, 1),
      'holidays:v1:US-2027': entry([], 1),
      'route:v2:junk': 'not json',
      'driving-path:retired': 'x',
      'itinerary.changes.v1/trip': '[]',
    });
    const { persisted } = cacheOver({ storage });
    const { calls, compute } = computing('refetched');

    expect(await persisted('route:v2:a', Infinity, compute)).toEqual({ travel: { minutes: 5 } });
    expect(calls.count).toBe(0);
    expect(storage.getItem('route:v2:a')).toBeNull();
    expect(storage.getItem('holidays:v1:US-2027')).toBeNull();
    // Unreadable cache entries and retired formats are just freed.
    expect(storage.getItem('route:v2:junk')).toBeNull();
    expect(storage.getItem('driving-path:retired')).toBeNull();
    // Not a cache: left alone.
    expect(storage.getItem('itinerary.changes.v1/trip')).toBe('[]');
  });

  it('runs once, before the first read only', async () => {
    const storage = new MemoryStorage();
    const { persisted } = cacheOver({ storage });
    await persisted('k', Infinity, async () => 'v');
    storage.setItem('place-coords:v1:later', entry({ lat: 1, lng: 2 }, 1));
    await persisted('k', Infinity, async () => 'v');
    expect(storage.getItem('place-coords:v1:later')).not.toBeNull();
  });

  it('still answers when the browser blocks localStorage', async () => {
    const { persisted, savesSettled } = createIdbCache({
      indexedDB: () => new IDBFactory(),
      storage: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      now: () => 0,
    });
    const { calls, compute } = computing('v');
    expect(await persisted('k', Infinity, compute)).toBe('v');
    await savesSettled();
    expect(await persisted('k', Infinity, compute)).toBe('v');
    expect(calls.count).toBe(1);
  });

  it('keeps the original savedAt, so TTLs carry over', async () => {
    const storage = new MemoryStorage({ 'weather-climate:v3:old': entry('stale', 1) });
    const { persisted } = cacheOver({ storage });
    expect(await persisted('weather-climate:v3:old', 1000, async () => 'refetched')).toBe(
      'refetched',
    );
  });

  it('still frees localStorage when IndexedDB is unavailable', async () => {
    const storage = new MemoryStorage({ 'route:v2:a': entry('x', 1) });
    const { persisted } = cacheOver({ storage, indexedDB: null });
    await persisted('k', Infinity, async () => 'v');
    expect(storage.getItem('route:v2:a')).toBeNull();
  });
});

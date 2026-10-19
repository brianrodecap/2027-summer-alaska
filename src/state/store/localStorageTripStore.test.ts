import { beforeEach, describe, expect, it } from 'vitest';

import type { Change } from '../../model/changeLog';
import { FullStorage, MemoryStorage } from '../../test/memoryStorage';
import { createLocalStorageTripStore } from './localStorageTripStore';

function change(key: string, batch = 'b1'): Change {
  return {
    collection: 'activities',
    batch,
    at: '2026-10-02T12:00:00.000Z',
    source: 'manual',
    op: 'delete',
    key,
    baseHash: null,
  };
}

describe('createLocalStorageTripStore', () => {
  let storage: Storage;
  beforeEach(() => {
    storage = new MemoryStorage();
  });

  it('loads an empty log for a scope it has never seen', async () => {
    expect(await createLocalStorageTripStore(storage).load('trip-a')).toEqual([]);
  });

  it('appends in order and keeps scopes separate', async () => {
    const store = createLocalStorageTripStore(storage);
    await store.append('trip-a', [change('x')]);
    await store.append('trip-a', [change('y', 'b2')]);
    await store.append('trip-b', [change('z')]);
    expect((await store.load('trip-a')).map((c) => ('key' in c ? c.key : null))).toEqual([
      'x',
      'y',
    ]);
    expect(await store.load('trip-b')).toHaveLength(1);
  });

  it('replace overwrites the log, and an empty replace removes the key', async () => {
    const store = createLocalStorageTripStore(storage);
    await store.append('trip-a', [change('x'), change('y')]);
    await store.replace('trip-a', [change('y')]);
    expect(await store.load('trip-a')).toEqual([change('y')]);
    await store.replace('trip-a', []);
    expect(storage.length).toBe(0);
  });

  it('re-reads a log another tab changed since this store last wrote it', async () => {
    const store = createLocalStorageTripStore(storage);
    await store.append('trip-a', [change('x')]);
    // Another tab's store appends to the same key.
    await createLocalStorageTripStore(storage).append('trip-a', [change('y', 'b2')]);
    await store.append('trip-a', [change('z', 'b3')]);
    expect((await store.load('trip-a')).map((c) => ('key' in c ? c.key : null))).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('treats corrupt stored JSON as an empty log instead of failing the load', async () => {
    storage.setItem('itinerary.changes.v1/trip-a', '{not json');
    expect(await createLocalStorageTripStore(storage).load('trip-a')).toEqual([]);
  });

  it('surfaces a failed write (e.g. quota) to the caller', async () => {
    await expect(
      createLocalStorageTripStore(new FullStorage()).append('trip-a', [change('x')]),
    ).rejects.toThrow('quota');
  });
});

import { beforeEach, describe, expect, it } from 'vitest';

import type { Change } from '../../model/changeLog';
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
  beforeEach(() => window.localStorage.clear());

  it('loads an empty log for a scope it has never seen', async () => {
    expect(await createLocalStorageTripStore().load('trip-a')).toEqual([]);
  });

  it('appends in order and keeps scopes separate', async () => {
    const store = createLocalStorageTripStore();
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
    const store = createLocalStorageTripStore();
    await store.append('trip-a', [change('x'), change('y')]);
    await store.replace('trip-a', [change('y')]);
    expect(await store.load('trip-a')).toEqual([change('y')]);
    await store.replace('trip-a', []);
    expect(window.localStorage.length).toBe(0);
  });

  it('re-reads a log another tab changed since this store last wrote it', async () => {
    const store = createLocalStorageTripStore();
    await store.append('trip-a', [change('x')]);
    // Another tab's store appends to the same key.
    await createLocalStorageTripStore().append('trip-a', [change('y', 'b2')]);
    await store.append('trip-a', [change('z', 'b3')]);
    expect((await store.load('trip-a')).map((c) => ('key' in c ? c.key : null))).toEqual([
      'x',
      'y',
      'z',
    ]);
  });

  it('treats corrupt stored JSON as an empty log instead of failing the load', async () => {
    window.localStorage.setItem('itinerary.changes.v1/trip-a', '{not json');
    expect(await createLocalStorageTripStore().load('trip-a')).toEqual([]);
  });

  it('surfaces a failed write (e.g. quota) to the caller', async () => {
    const full = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException('quota', 'QuotaExceededError');
      },
      removeItem: () => {},
    } as unknown as Storage;
    await expect(createLocalStorageTripStore(full).append('trip-a', [change('x')])).rejects.toThrow(
      'quota',
    );
  });
});

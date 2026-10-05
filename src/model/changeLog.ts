// The persisted edit history behind TripDataContext: every edit is recorded as a list
// of per-entity Changes against the trip's shipped JSON (public/data/<slug>/), and the
// live TripData is always "shipped baseline + changes replayed in order". Shaped like a
// document store (collection + key, upsert/delete) on purpose, so the storage layer
// under it (src/state/store/) can move from localStorage to a real backend without
// this module or any caller changing.
//
// Pure and framework-agnostic, like tripModel.ts — no React, no storage access.
import type { TripData } from './types';

export const COLLECTIONS = [
  'trip',
  'legs',
  'stays',
  'transits',
  'activities',
  'bookings',
  'scenarios',
  'notes',
  'travelModeOverrides',
  'routes',
] as const;

// Which raw JSON collection an edit touched — also what "export edits" uses to know
// which file(s) need re-copying into public/data/<slug>/.
export type CollectionName = (typeof COLLECTIONS)[number];

// Collections shared by every trip (public/data/routes.json), so their changes are
// stored under one shared scope rather than under a single trip's slug.
export const SHARED_COLLECTIONS: ReadonlySet<CollectionName> = new Set(['routes']);

export type ChangeSource = 'manual' | 'ai-chat' | 'ai-import';

interface ChangeMeta {
  collection: CollectionName;
  // Every Change produced by one setData call shares a batch id, so Undo reverts a
  // whole user action (e.g. a drag that retimed three activities) as one step.
  batch: string;
  at: string;
  source: ChangeSource;
}

export type Change =
  | (ChangeMeta & {
      op: 'upsert';
      key: string;
      doc: unknown;
      // Hash of the shipped document this change was made against (null when the
      // entity didn't exist in the shipped JSON) — how replay notices the shipped
      // JSON changed underneath a local edit.
      baseHash: string | null;
    })
  | (ChangeMeta & { op: 'delete'; key: string; baseHash: string | null })
  // A pure reordering. Array position is meaningful for one thing in this app —
  // same-instant ties produced by drag-and-drop (reorder.ts's reinsertAfterAnchor) —
  // so a drag that only moves an entry within its collection must survive a reload.
  | (ChangeMeta & { op: 'order'; keys: string[] });

// travelModeOverrides is the one collection without an _id; its natural key is the
// segment it overrides.
function keyOf(collection: CollectionName, doc: unknown): string {
  const record = doc as { _id?: string; segmentKey?: string };
  return (collection === 'travelModeOverrides' ? record.segmentKey : record._id) ?? '';
}

// JSON.stringify with object keys sorted, so two structurally identical documents
// compare equal regardless of the order an edit form happened to build them in.
export function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

// FNV-1a over the stable serialization — only ever compared against another hash of
// the same kind, to detect "this shipped document changed", so 32 bits is plenty.
export function hashDoc(doc: unknown): string {
  const text = stableStringify(doc);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

// trip.json is one document rather than an array, so it's tracked as a
// one-entry collection keyed by its _id (a document import adding a traveler
// edits it like any other entity).
// collectionOf and withCollection are the only code that knows it.
function collectionOf(data: TripData, collection: CollectionName): unknown[] {
  return collection === 'trip' ? [data.trip] : (data[collection] as unknown[]);
}

function withCollection(data: TripData, collection: CollectionName, items: unknown[]): TripData {
  return collection === 'trip'
    ? { ...data, trip: items[0] as TripData['trip'] }
    : { ...data, [collection]: items };
}

function byKey(collection: CollectionName, items: unknown[]): Map<string, unknown> {
  return new Map(items.map((item) => [keyOf(collection, item), item]));
}

function baselineHash(baseline: TripData, collection: CollectionName, key: string): string | null {
  const doc = collectionOf(baseline, collection).find((item) => keyOf(collection, item) === key);
  return doc === undefined ? null : hashDoc(doc);
}

function sameKeys(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((key, i) => key === b[i]);
}

// What one setData call changed, as Changes. Only collections whose array identity
// changed are compared (every edit path builds a new array for what it touches), and
// within those an entry whose reference is unchanged is skipped before falling back to
// a structural comparison.
export function diffTripData(
  prev: TripData,
  next: TripData,
  baseline: TripData,
  meta: Omit<ChangeMeta, 'collection'>,
): Change[] {
  const changes: Change[] = [];
  for (const collection of COLLECTIONS) {
    const prevItems = collectionOf(prev, collection);
    const nextItems = collectionOf(next, collection);
    if (prevItems === nextItems) continue;

    const prevByKey = byKey(collection, prevItems);
    const nextKeys = nextItems.map((item) => keyOf(collection, item));
    const nextKeySet = new Set(nextKeys);

    nextItems.forEach((item, i) => {
      const key = nextKeys[i];
      const before = prevByKey.get(key);
      if (before === item) return;
      if (before !== undefined && stableStringify(before) === stableStringify(item)) return;
      changes.push({
        ...meta,
        collection,
        op: 'upsert',
        key,
        doc: item,
        baseHash: baselineHash(baseline, collection, key),
      });
    });

    for (const key of prevByKey.keys()) {
      if (!nextKeySet.has(key)) {
        changes.push({
          ...meta,
          collection,
          op: 'delete',
          key,
          baseHash: baselineHash(baseline, collection, key),
        });
      }
    }

    // Replaying the upserts/deletes alone keeps survivors in place and appends new
    // keys at the end; only record an explicit order when that isn't what happened.
    const prevKeys = [...prevByKey.keys()];
    const prevKeySet = new Set(prevKeys);
    const implied = [
      ...prevKeys.filter((key) => nextKeySet.has(key)),
      ...nextKeys.filter((key) => !prevKeySet.has(key)),
    ];
    if (!sameKeys(implied, nextKeys)) {
      changes.push({ ...meta, collection, op: 'order', keys: nextKeys });
    }
  }
  return changes;
}

// ---------- replay ----------

export interface ReplayResult {
  data: TripData;
  // The changes that survived — what storage should hold from now on.
  kept: Change[];
}

function applyOrder(collection: CollectionName, items: unknown[], keys: string[]): unknown[] {
  const lookup = byKey(collection, items);
  const ordered = keys.filter((key) => lookup.has(key)).map((key) => lookup.get(key));
  const listed = new Set(keys);
  // Entities the order didn't know about (added to the shipped JSON later) keep their
  // relative order, after the ones it did.
  return [...ordered, ...items.filter((item) => !listed.has(keyOf(collection, item)))];
}

function applyChange(items: unknown[], change: Change): unknown[] {
  const { collection } = change;
  if (change.op === 'order') return applyOrder(collection, items, change.keys);
  const index = items.findIndex((item) => keyOf(collection, item) === change.key);
  if (change.op === 'delete') return index === -1 ? items : items.filter((_, i) => i !== index);
  if (index === -1) return [...items, change.doc];
  return items.map((item, i) => (i === index ? change.doc : item));
}

// Shipped JSON always wins over a local edit made against an older version of the same
// entity. Either the edit was exported, copied into public/data/ and deployed (shipped
// now matches local, so the change is redundant), or the entity changed upstream for
// some other reason (and the user chose upstream over the local edit). Both cases drop
// every local change to that entity; the caller then compacts them out of storage.
export function replayChanges(baseline: TripData, changes: Change[]): ReplayResult {
  const latest = new Map<string, Extract<Change, { key: string }>>();
  for (const change of changes) {
    if (change.op !== 'order') latest.set(`${change.collection}\u0000${change.key}`, change);
  }
  const drifted = new Set<string>();
  for (const [id, change] of latest) {
    if (baselineHash(baseline, change.collection, change.key) !== change.baseHash) drifted.add(id);
  }

  const kept = changes.filter(
    (change) => change.op === 'order' || !drifted.has(`${change.collection}\u0000${change.key}`),
  );

  const touched = new Map<CollectionName, unknown[]>();
  for (const change of kept) {
    const items = touched.get(change.collection) ?? collectionOf(baseline, change.collection);
    touched.set(change.collection, applyChange(items, change));
  }
  let data = baseline;
  for (const [collection, items] of touched) data = withCollection(data, collection, items);
  return { data, kept };
}

// The collections with at least one local change — what "Export edits" downloads.
export function changedCollections(changes: Change[]): Set<CollectionName> {
  return new Set(changes.map((change) => change.collection));
}

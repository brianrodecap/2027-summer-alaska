# Scenario-group and Transit Drag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a Transit be dragged (via a handle on its Depart row) and an entire scenario-group bundle be dragged (via a handle on the `ScenarioTabsNode` row), on top of the existing per-Activity drag-and-drop in `src/model/reorder.ts`.

**Architecture:** Generalize `reorder.ts`'s existing `DragMeta`/`applyActivityReorder` machinery — a Depart row becomes a real drag source resolving to a new `applyTransitReorder` (moves `departsAt`, shifts `arrivesAt` only when unrouted, reassigns `legId`/`scenarioId`), and the `scenario-tabs` row (currently skipped by `buildDragMeta` entirely) becomes a drag source whose payload is every Activity/Transit id under its whole subtree, resolving to a new `applyBlockReorder` (shifts every member by one shared time delta, reassigns `legId` only, `scenarioId` never touched). `DayTimeline.tsx` wires two new handles; `DaysView.tsx`'s `handleDragEnd` gains two new branches.

**Tech Stack:** React + TypeScript, `@dnd-kit/core`/`@dnd-kit/sortable`, Vitest.

**Spec:** `docs/superpowers/specs/2026-08-30-scenario-transit-drag-design.md`

## Global Constraints

- Tests use synthetic in-memory fixtures only — never `loadRealTripData()`.
- Do all date/time math on plain ISO strings via `tripModel.ts`'s existing `wallClockMs`/`addMinutesIso` helpers — never construct/compare raw `Date` objects elsewhere.
- `scenarioId` is never reassigned by a scenario-group drag (every member keeps its own branch); `legId` is reassigned for both new gestures.
- No new auto-cascade: neither new gesture pushes bystander rows out of the way at the drop point.
- Run `npx vitest run src/model/reorder.test.ts src/model/tripModel.test.ts` after every reorder.ts/tripModel.ts change, and `npm run validate` at the end of the plan.

---

## Task 1: `diffMinutesIso` helper

**Files:**

- Modify: `src/model/tripModel.ts` (add helper next to `addMinutesIso`, around line 605)
- Test: `src/model/tripModel.test.ts`

**Interfaces:**

- Produces: `diffMinutesIso(a: string, b: string): number` — minutes from `a` to `b` (positive when `b` is later), used by `reorder.ts`'s `applyTransitReorder`/`applyBlockReorder` in Task 4/6.

- [ ] **Step 1: Write the failing test**

Add to `src/model/tripModel.test.ts`:

```ts
describe('diffMinutesIso', () => {
  it('returns positive minutes when b is later than a', () => {
    expect(diffMinutesIso('2027-06-01T08:00', '2027-06-01T09:30')).toBe(90);
  });

  it('returns negative minutes when b is earlier than a', () => {
    expect(diffMinutesIso('2027-06-01T09:30', '2027-06-01T08:00')).toBe(-90);
  });

  it('returns zero for the same instant', () => {
    expect(diffMinutesIso('2027-06-01T08:00', '2027-06-01T08:00')).toBe(0);
  });

  it('crosses a calendar day boundary correctly', () => {
    expect(diffMinutesIso('2027-06-01T23:30', '2027-06-02T00:15')).toBe(45);
  });
});
```

Add `diffMinutesIso` to the existing `import { ... } from './tripModel'` at the top of the file.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/model/tripModel.test.ts -t diffMinutesIso`
Expected: FAIL — `diffMinutesIso` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `src/model/tripModel.ts`, immediately after `addMinutesIso` (currently lines 603-605):

```ts
export function diffMinutesIso(a: string, b: string): number {
  return (wallClockMs(b) - wallClockMs(a)) / 60000;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/model/tripModel.test.ts -t diffMinutesIso`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/model/tripModel.ts src/model/tripModel.test.ts
git commit -m "Add diffMinutesIso helper for computing a uniform drag time-shift"
```

---

## Task 2: Generalize `DragMeta.anchorActivityId` to `anchorEntityId`

This is a pure mechanical rename (no new behavior) that both `applyTransitReorder`
(Task 4) and `applyBlockReorder`'s siblings need: today `anchorActivityId` can only
ever name an Activity, but a Transit now needs the same "insert immediately after
this entity in its own array" tie-break `applyActivityReorder` already gives
Activities.

**Files:**

- Modify: `src/model/reorder.ts`
- Modify: `src/model/reorder.test.ts` (every existing reference to `anchorActivityId`)

**Interfaces:**

- Produces: `DragMeta['anchorEntityId']: { kind: 'activity' | 'transit'; id: string } | null` (replaces `anchorActivityId: string | null`); same field inside `DragMeta['before']`.

- [ ] **Step 1: Update the `DragMeta` and `RealAnchor` types**

In `src/model/reorder.ts`, change the `DragMeta` interface (currently lines 102-144):

```ts
export interface DragMeta {
  id: string;
  index: number;
  endAt: string | null;
  containerDayStart: string;
  legId: string;
  scenarioId: string | null;
  activityId: string | null;
  anchorEntityId: { kind: 'activity' | 'transit'; id: string } | null;
  kind: 'after' | 'day-start' | 'front-takeover';
  cascadeActivityIds?: string[];
  before?: {
    endAt: string;
    legId: string;
    anchorEntityId: { kind: 'activity' | 'transit'; id: string } | null;
    cascadeActivityIds: string[];
    kind: 'after' | 'front-takeover';
  };
}
```

(Keep every existing comment on the interface — only the two `anchorActivityId` lines change name/type. Leave `transitId`/`scenarioGroup` for Tasks 3 and 5.)

Change `RealAnchor` (currently lines 146-151):

```ts
interface RealAnchor {
  endAt: string;
  legId: string;
  entityId: { kind: 'activity' | 'transit'; id: string } | null;
  activityStartAt: string | null;
}
```

- [ ] **Step 2: Update `buildRealAnchors`**

Replace the function body (currently lines 157-179) so every pushed anchor sets
`entityId` instead of `activityId`:

```ts
function buildRealAnchors(flattened: SequenceItem[], dayStart: string): RealAnchor[] {
  const anchors: RealAnchor[] = [];
  for (const item of flattened) {
    if (item.type === 'transit-boundary' || item.type === 'transit-stage') {
      anchors.push({
        endAt: item.key,
        legId: item.transit.legId,
        entityId: { kind: 'transit', id: item.transit._id },
        activityStartAt: null,
      });
    } else if (item.type === 'section') {
      for (const activity of item.activities) {
        anchors.push({
          endAt: activityAnchorEndAt(activity, dayStart),
          legId: activity.legId,
          entityId: { kind: 'activity', id: activity._id },
          activityStartAt: activity.startAt,
        });
      }
    }
  }
  return anchors;
}
```

(This now names the owning Transit on both its boundary and stage anchors, not just
`null` — a dropped _Transit_ landing right after another Transit's arrival or a stage
needs that to resolve its own array position in Task 4; a dropped _Activity_ landing
there is unaffected, since `applyActivityReorder`'s own repositioning — Step 4 below —
only ever consults an `anchorEntityId` of `kind: 'activity'`.)

- [ ] **Step 3: Update `beforeFieldsAt` and the three `flatMap` branches that build `DragMeta`**

In `buildDragMeta` (currently lines 184-341):

`beforeFieldsAt` (currently lines 220-232) — change `anchorActivityId: preceding?.activityId ?? null,` to:

```ts
        anchorEntityId: preceding?.entityId ?? null,
```

The `'Check out'` Stay branch (currently around lines 244-259): unchanged in shape —
`anchorActivityId: null,` becomes `anchorEntityId: null,`.

The `'Check in'` Stay branch (currently around lines 260-273): `anchorActivityId:
lastAnchor?.activityId ?? null,` becomes:

```ts
            anchorEntityId: lastAnchor?.entityId ?? null,
```

The plain `'Staying'` Stay branch (currently around lines 278-288): `anchorActivityId:
null,` becomes `anchorEntityId: null,`.

The `'transit-boundary'` branch (currently around lines 290-305) and the
`'transit-stage'` branch (currently around lines 306-321): each currently has
`anchorActivityId: null,` — becomes `anchorEntityId: null,` (Task 3 fills in this
branch's real `transitId`/draggability; this step is the rename only).

The `'section'` (Activity) branch (currently around lines 322-337): `anchorActivityId:
activity._id,` becomes:

```ts
            anchorEntityId: { kind: 'activity', id: activity._id },
```

- [ ] **Step 4: Update `applyActivityReorder`'s repositioning**

In `applyActivityReorder` (currently around lines 533-537), replace:

```ts
let insertAt = rest.length;
if (dropMeta.anchorActivityId) {
  const anchorIdx = rest.findIndex((a) => a._id === dropMeta.anchorActivityId);
  if (anchorIdx !== -1) insertAt = anchorIdx + 1;
}
```

with:

```ts
let insertAt = rest.length;
if (dropMeta.anchorEntityId?.kind === 'activity') {
  const anchorId = dropMeta.anchorEntityId.id;
  const anchorIdx = rest.findIndex((a) => a._id === anchorId);
  if (anchorIdx !== -1) insertAt = anchorIdx + 1;
}
```

- [ ] **Step 5: Update `applyGroupActivityReorder`'s chaining**

In `applyGroupActivityReorder` (currently around lines 596-604), replace
`anchorActivityId: placed._id,` with:

```ts
      anchorEntityId: { kind: 'activity', id: placed._id },
```

- [ ] **Step 6: Update the `EmptyDropZone` placeholder in `DayTimeline.tsx`**

In `src/components/day/DayTimeline.tsx`, the `placeholderMeta` object (currently
around lines 614-624) has `anchorActivityId: null,` — change to `anchorEntityId:
null,`.

- [ ] **Step 7: Update every `reorder.test.ts` reference**

In `src/model/reorder.test.ts`, mechanically replace every use:

- `dragMeta[0].anchorActivityId` → `dragMeta[0].anchorEntityId` (comparisons against
  `.toBeNull()` are unchanged; a comparison against a bare string like `expect(...).toBe('act1')` becomes `expect(...).toEqual({ kind: 'activity', id: 'act1' })`).
- Every object literal field `anchorActivityId: null,` → `anchorEntityId: null,`.
- Every object literal field `anchorActivityId: 'anchor',` (the
  `applyGroupActivityReorder` describe block's `dropMeta`) → `anchorEntityId: { kind: 'activity', id: 'anchor' },`.
- `dragMeta.find((d) => d.anchorActivityId === 'act1')` → `dragMeta.find((d) => d.anchorEntityId?.kind === 'activity' && d.anchorEntityId.id === 'act1')`.
- Inside `.before` object literals (the `'front-takeover'` tests), `anchorActivityId: preceding?.activityId ?? null` references don't appear directly in the test file (only in reorder.ts, already handled) — just check every `before: { ... anchorActivityId ...}`-shaped literal if any exist and rename the same way. (Grep confirms none — the test file only ever reads `.before` back out, never constructs one.)

Run this to find every remaining occurrence before moving on:

```bash
grep -n anchorActivityId src/model/reorder.test.ts src/model/reorder.ts src/components/day/DayTimeline.tsx
```

Expected: no output (everything renamed).

- [ ] **Step 8: Run the full reorder test suite**

Run: `npx vitest run src/model/reorder.test.ts`
Expected: PASS (all existing tests, now referencing `anchorEntityId`)

- [ ] **Step 9: Commit**

```bash
git add src/model/reorder.ts src/model/reorder.test.ts src/components/day/DayTimeline.tsx
git commit -m "Generalize DragMeta's anchorActivityId to anchorEntityId (activity or transit)"
```

---

## Task 3: Make a Transit's Depart row a drag source in `buildDragMeta`

**Files:**

- Modify: `src/model/reorder.ts`
- Test: `src/model/reorder.test.ts`

**Interfaces:**

- Produces: `DragMeta['transitId']: string | null | undefined` — set to the Transit's
  own `_id` only on its Depart row's DragMeta entry (mirrors the existing `activityId`
  field); `undefined` (field omitted) everywhere else, same convention
  `cascadeActivityIds?:` already uses.

- [ ] **Step 1: Write the failing test**

Add to `src/model/reorder.test.ts`, inside the existing `describe('buildDragMeta', ...)` block:

```ts
it('only the Depart boundary carries a transitId — Arrive does not', () => {
  const transit: EnrichedTransit = {
    _id: 'transit1',
    legId: 'legA',
    journeyId: null,
    scenarioId: null,
    status: 'planning',
    mode: 'drive',
    from: { id: null, label: 'A' },
    to: { id: null, label: 'B' },
    departsAt: '2027-06-01T08:00',
    routeId: null,
    routeVariant: null,
    booking: null,
    images: [],
    routeInfo: null,
    arrivesAt: '2027-06-01T09:30',
    notes: [],
    hasWarningNote: false,
  };
  const flattened: SequenceItem[] = [
    { type: 'transit-boundary', transit, phase: 'depart', key: '2027-06-01T08:00' },
    { type: 'transit-boundary', transit, phase: 'arrive', key: '2027-06-01T09:30' },
  ];
  const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
  const depart = dragMeta.find((d) => d.id === 'transit-transit1-depart')!;
  const arrive = dragMeta.find((d) => d.id === 'transit-transit1-arrive')!;
  expect(depart.transitId).toBe('transit1');
  expect(arrive.transitId).toBeFalsy();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/model/reorder.test.ts -t transitId`
Expected: FAIL — `buildDragMeta` doesn't accept a 4th argument yet and `transitId` is
always `undefined`.

- [ ] **Step 3: Add the `dayLegId` parameter and `transitId` field**

In `src/model/reorder.ts`, change `buildDragMeta`'s signature (currently around line
184-188):

```ts
export function buildDragMeta(
  flattened: SequenceItem[],
  scenarioId: string | null,
  dayStart: string,
  dayLegId: string,
): DragMeta[] {
```

Add `transitId?: string | null;` to the `DragMeta` interface, right after
`activityId: string | null;`.

In the `'transit-boundary'` branch of `buildDragMeta`'s `flatMap` (currently around
lines 290-305), add `transitId: item.phase === 'depart' ? item.transit._id : null,`
right after `activityId: null,`:

```ts
if (item.type === 'transit-boundary') {
  realAnchorIdx += 1;
  return [
    {
      id: `transit-${item.transit._id}-${item.phase}`,
      endAt: item.key,
      legId: item.transit.legId,
      scenarioId,
      activityId: null,
      transitId: item.phase === 'depart' ? item.transit._id : null,
      anchorEntityId: null,
      kind: 'after',
      cascadeActivityIds: downstreamActivityIds(realAnchorIdx + 1),
      ...beforeFieldsAt(realAnchorIdx, item.transit.legId),
    },
  ];
}
```

- [ ] **Step 4: Update every other `buildDragMeta` call site to pass `dayLegId`**

In `src/components/day/DayTimeline.tsx`, the one call site (currently line 636):

```ts
const dragMeta = buildDragMeta(flattened, scenarioId, dayStart, day.leg._id);
```

In `src/model/reorder.test.ts`, every existing call to `buildDragMeta(flattened, ...,
DAY_START)` or with a different day-start literal gets a trailing `'legA'` argument
(matching the fixtures' own `legId: 'legA'` convention already used throughout the
file). There are calls at (line numbers from the pre-Task-2 file — re-locate by
searching `buildDragMeta(`): the `resolveDropTiming`-adjacent `'anchors exactly...'`
test, `'anchors exactly on a non-meal Activity...'`, `'uses an explicit
durationMinutes...'`, `"uses a meal's estimated duration..."`, both Check-out tests,
both Check-in tests, the Stay-dragId-uniqueness test's two calls (use `'legA'` for
both), the tie-break test, the leg-transition test, the mid-day cascade test, the
upward-drag test, the front-takeover tests, and the cross-container test. Run:

```bash
grep -n 'buildDragMeta(' src/model/reorder.test.ts
```

and add `, 'legA'` as the final argument to every call that doesn't already have a
4th argument.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/model/reorder.test.ts`
Expected: PASS (all tests, including the new one)

- [ ] **Step 6: Commit**

```bash
git add src/model/reorder.ts src/model/reorder.test.ts src/components/day/DayTimeline.tsx
git commit -m "Give a Transit's Depart row its own drag-source id in buildDragMeta"
```

---

## Task 4: `applyTransitReorder`

**Files:**

- Modify: `src/model/reorder.ts`
- Test: `src/model/reorder.test.ts`

**Interfaces:**

- Consumes: `resolveDropTiming` (existing), `diffMinutesIso`/`addMinutesIso` (Task 1, `tripModel.ts`).
- Produces: `applyTransitReorder(data: TripData, dropMeta: DragMeta, transitId: string, dayStart: string, preserveOwnTiming = false): TripData`.

- [ ] **Step 1: Write the failing tests**

Add a new `describe('applyTransitReorder', ...)` block to `src/model/reorder.test.ts`
(after the existing `applyActivityReorder` block):

```ts
describe('applyTransitReorder', () => {
  function transit(overrides: Partial<EnrichedTransit>): EnrichedTransit {
    return {
      _id: 'transit1',
      legId: 'legA',
      journeyId: null,
      scenarioId: null,
      status: 'planning',
      mode: 'drive',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      departsAt: '2027-06-01T08:00',
      routeId: null,
      routeVariant: null,
      booking: null,
      images: [],
      routeInfo: null,
      arrivesAt: '2027-06-01T09:30',
      notes: [],
      hasWarningNote: false,
      ...overrides,
    };
  }

  it('shifts arrivesAt by the same delta as departsAt for an unrouted Transit, preserving its duration', () => {
    const dropMeta: DragMeta = {
      id: 'activity-anchor',
      index: 0,
      endAt: '2027-06-01T12:00',
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({})],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', DAY_START);
    const moved = next.transits.find((t) => t._id === 'transit1');
    // Original duration was 90 minutes (08:00 -> 09:30); dropped at 12:00 ->
    // arrivesAt must land at 13:30 to preserve it.
    expect(moved?.departsAt).toBe('2027-06-01T12:00');
    expect(moved?.arrivesAt).toBe('2027-06-01T13:30');
  });

  it('leaves arrivesAt alone for a routed Transit — buildTripView recomputes it from the new departsAt', () => {
    const dropMeta: DragMeta = {
      id: 'activity-anchor',
      index: 0,
      endAt: '2027-06-01T12:00',
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({ routeId: 'route1', arrivesAt: null })],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', DAY_START);
    const moved = next.transits.find((t) => t._id === 'transit1');
    expect(moved?.departsAt).toBe('2027-06-01T12:00');
    expect(moved?.arrivesAt).toBeNull();
  });

  it('reassigns legId and scenarioId to the drop target', () => {
    const dropMeta: DragMeta = {
      id: 'activity-anchor',
      index: 0,
      endAt: '2027-06-01T12:00',
      containerDayStart: DAY_START,
      legId: 'legB',
      scenarioId: 'scenario1',
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({ legId: 'legA', scenarioId: null })],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', DAY_START);
    const moved = next.transits.find((t) => t._id === 'transit1');
    expect(moved?.legId).toBe('legB');
    expect(moved?.scenarioId).toBe('scenario1');
  });

  it('rebases onto the destination day, keeping time-of-day, on a cross-day drop with no real anchor', () => {
    const dropMeta: DragMeta = {
      id: 'empty-2027-07-13',
      index: 0,
      endAt: null,
      containerDayStart: '2027-07-13T00:00',
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({ departsAt: '2027-06-01T08:00', arrivesAt: '2027-06-01T09:30' })],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', '2027-07-13T00:00');
    const moved = next.transits.find((t) => t._id === 'transit1');
    expect(moved?.departsAt).toBe('2027-07-13T08:00');
    expect(moved?.arrivesAt).toBe('2027-07-13T09:30');
  });

  it('a same-day cross-container drop preserves the Transit’s own timing when preserveOwnTiming is set', () => {
    const dropMeta: DragMeta = {
      id: 'activity-anchor',
      index: 0,
      endAt: '2027-06-01T15:00',
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: 'scenario2',
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({})],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', DAY_START, true);
    const moved = next.transits.find((t) => t._id === 'transit1');
    expect(moved?.departsAt).toBe('2027-06-01T08:00'); // untouched
    expect(moved?.arrivesAt).toBe('2027-06-01T09:30'); // untouched
    expect(moved?.scenarioId).toBe('scenario2'); // still reassigned
  });

  it('repositions the Transit in data.transits right after anchorEntityId when it names another transit', () => {
    const dropMeta: DragMeta = {
      id: 'transit-transit2-arrive',
      index: 0,
      endAt: '2027-06-01T12:00',
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: null,
      activityId: null,
      anchorEntityId: { kind: 'transit', id: 'transit2' },
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [
        transit({ _id: 'transit1' }),
        transit({ _id: 'transit2', departsAt: '2027-06-01T10:00', arrivesAt: '2027-06-01T11:00' }),
      ],
      activities: [],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyTransitReorder(data, dropMeta, 'transit1', DAY_START);
    const ids = next.transits.map((t) => t._id);
    expect(ids.indexOf('transit1')).toBe(ids.indexOf('transit2') + 1);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/model/reorder.test.ts -t applyTransitReorder`
Expected: FAIL — `applyTransitReorder` is not exported.

- [ ] **Step 3: Implement `applyTransitReorder`**

Add to `src/model/reorder.ts`, after `applyActivityReorder` (before
`applyGroupActivityReorder`):

```ts
// Moves a Transit — dragged via its own Depart row's handle — as one
// compound unit: the whole Transit (Depart boundary, every route stage,
// Arrive boundary) travels together, since stages/Arrive are always
// derived from this Transit's own departsAt (routed: via buildTripView's
// route walk; unrouted: from its own authored arrivesAt), never
// independently authored the way an Activity's own position is. Mirrors
// applyActivityReorder's timing rules exactly (resolveDropTiming,
// crossesDay re-basing, preserveOwnTiming for a same-day container
// crossing) but operates on data.transits and never cascades bystanders —
// see the design spec's "No new auto-cascade for v1".
export function applyTransitReorder(
  data: TripData,
  dropMeta: DragMeta,
  transitId: string,
  dayStart: string,
  preserveOwnTiming = false,
): TripData {
  const transit = data.transits.find((t) => t._id === transitId);
  if (!transit) return data;

  const endAt = preserveOwnTiming ? null : dropMeta.endAt;
  const crossesDay = transit.departsAt.slice(0, 10) !== dayStart.slice(0, 10);
  const timing = resolveDropTiming(endAt, dayStart, transit.departsAt, crossesDay);

  // A routed drive (routeId set) never carries its own arrivesAt —
  // buildTripView's route walk recomputes it, and every stage time, fresh
  // from departsAt on every render, so only departsAt needs to move here.
  // An unrouted Transit's arrivesAt is its own authored field, though —
  // shifting departsAt alone would silently collapse or inflate its
  // duration, so arrivesAt moves by the same delta to preserve it exactly.
  const updated: Transit = {
    ...transit,
    departsAt: timing.startAt,
    arrivesAt:
      transit.routeId || !transit.arrivesAt
        ? transit.arrivesAt
        : addMinutesIso(timing.startAt, diffMinutesIso(transit.departsAt, transit.arrivesAt)),
    legId: dropMeta.legId,
    scenarioId: dropMeta.scenarioId,
  };

  const rest = data.transits.filter((t) => t._id !== transitId);
  let insertAt = rest.length;
  if (dropMeta.anchorEntityId?.kind === 'transit') {
    const anchorId = dropMeta.anchorEntityId.id;
    const anchorIdx = rest.findIndex((t) => t._id === anchorId);
    if (anchorIdx !== -1) insertAt = anchorIdx + 1;
  }

  return {
    ...data,
    transits: [...rest.slice(0, insertAt), updated, ...rest.slice(insertAt)],
  };
}
```

Add `diffMinutesIso` to the existing `import { activityDurationMinutes,
activitySortKey, addMinutesIso } from './tripModel';` at the top of `reorder.ts`, and
add `Transit` to the existing `import type { Activity, SequenceItem, TripData } from
'./types';`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/model/reorder.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/model/reorder.ts src/model/reorder.test.ts
git commit -m "Add applyTransitReorder for dragging a Transit via its Depart row"
```

---

## Task 5: Scenario-group `DragMeta` entry (`collectScenarioGroupMembers`)

**Files:**

- Modify: `src/model/reorder.ts`
- Test: `src/model/reorder.test.ts`

**Interfaces:**

- Produces: `DragMeta['scenarioGroup']: { activityIds: string[]; transitIds: string[] } | null | undefined`, populated only on the one `DragMeta` entry built for a `{ type: 'scenario-tabs' }` sequence item.

- [ ] **Step 1: Write the failing tests**

Add to `src/model/reorder.test.ts`, inside `describe('buildDragMeta', ...)`:

```ts
it('gives the scenario-tabs row a scenarioGroup naming every Activity/Transit across every branch, including nested children', () => {
  const idealTransit: EnrichedTransit = {
    _id: 'idealTransit',
    legId: 'legA',
    journeyId: null,
    scenarioId: 'ideal',
    status: 'planning',
    mode: 'drive',
    from: { id: null, label: 'A' },
    to: { id: null, label: 'B' },
    departsAt: '2027-06-01T08:00',
    routeId: null,
    routeVariant: null,
    booking: null,
    images: [],
    routeInfo: null,
    arrivesAt: '2027-06-01T09:00',
    notes: [],
    hasWarningNote: false,
  };
  const tracks: ScenarioTrack[] = [
    {
      scenario: {
        _id: 'ideal',
        legId: 'legA',
        tone: 'ideal',
        label: 'Ideal',
        icon: 'sunny',
        images: [],
      },
      notes: [],
      anchorKey: '2027-06-01T08:00',
      realAnchorKey: '2027-06-01T08:00',
      sequence: [
        {
          type: 'transit-boundary',
          transit: idealTransit,
          phase: 'depart',
          key: '2027-06-01T08:00',
        },
        {
          type: 'section',
          activities: [
            activity({ _id: 'idealAct', scenarioId: 'ideal', startAt: '2027-06-01T10:00' }),
          ],
        },
      ],
    },
    {
      scenario: {
        _id: 'alt',
        legId: 'legA',
        tone: 'alternate',
        label: 'Alt',
        icon: 'rainy',
        images: [],
      },
      notes: [],
      anchorKey: '2027-06-01T08:00',
      realAnchorKey: '2027-06-01T08:00',
      sequence: [
        {
          type: 'section',
          activities: [activity({ _id: 'altAct', scenarioId: 'alt', startAt: '2027-06-01T09:00' })],
        },
        {
          type: 'scenario-tabs',
          key: '2027-06-01T13:00',
          tracks: [
            {
              scenario: {
                _id: 'nested',
                legId: 'legA',
                tone: 'alternate',
                label: 'Nested',
                icon: 'cloud',
                images: [],
                parentScenarioId: 'alt',
              },
              notes: [],
              anchorKey: '2027-06-01T13:00',
              realAnchorKey: '2027-06-01T13:00',
              sequence: [
                {
                  type: 'section',
                  activities: [
                    activity({
                      _id: 'nestedAct',
                      scenarioId: 'nested',
                      startAt: '2027-06-01T13:00',
                    }),
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  ];
  const flattened: SequenceItem[] = [{ type: 'scenario-tabs', key: '2027-06-01T08:00', tracks }];
  const dragMeta = buildDragMeta(flattened, null, DAY_START, 'legA');
  expect(dragMeta).toHaveLength(1);
  expect(dragMeta[0].scenarioGroup?.activityIds.sort()).toEqual([
    'altAct',
    'idealAct',
    'nestedAct',
  ]);
  expect(dragMeta[0].scenarioGroup?.transitIds).toEqual(['idealTransit']);
});
```

Add `ScenarioTrack` to the existing `import type { ... } from './types';` in
`reorder.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/model/reorder.test.ts -t scenarioGroup`
Expected: FAIL — the `scenario-tabs` branch of `buildDragMeta` currently returns `[]`.

- [ ] **Step 3: Implement `collectScenarioGroupMembers` and wire it into `buildDragMeta`**

Add `scenarioGroup?: { activityIds: string[]; transitIds: string[] } | null;` to the
`DragMeta` interface, right after `transitId?: string | null;`.

Add this function to `src/model/reorder.ts`, just above `buildDragMeta`:

```ts
// Every Activity/Transit id under one scenario-tabs node's own subtree —
// every branch (the tracks passed in), plus any nested child scenario-tabs
// group each track's own sequence folds in (buildScenarioTracks' own
// parentScenarioId nesting, tripModel.ts) — walked recursively so a
// scenario-group drag picks up a nested weather-inside-a-delay split's
// content too, not just the immediate tracks. A Transit's boundary and
// stage rows both name the same transit._id, so transitIds is deduplicated;
// an Activity only ever appears in one track's own sequence, so no
// deduplication is needed there.
function collectScenarioGroupMembers(tracks: ScenarioTrack[]): {
  activityIds: string[];
  transitIds: string[];
} {
  const activityIds = new Set<string>();
  const transitIds = new Set<string>();
  const walk = (list: ScenarioTrack[]) => {
    for (const track of list) {
      for (const item of track.sequence) {
        if (item.type === 'section') {
          for (const a of item.activities) activityIds.add(a._id);
        } else if (item.type === 'transit-boundary' || item.type === 'transit-stage') {
          transitIds.add(item.transit._id);
        } else if (item.type === 'scenario-tabs' && item.tracks) {
          walk(item.tracks);
        }
      }
    }
  };
  walk(tracks);
  return { activityIds: [...activityIds], transitIds: [...transitIds] };
}
```

Replace the `scenario-tabs` branch of `buildDragMeta`'s `flatMap` (currently `return
[]; // scenario-tabs`) with:

```ts
// scenario-tabs — its own drag source (the whole bundle, every branch),
// never a drop target: see DayTimeline.tsx's droppable: false wiring
// (Task 7). `before` is intentionally omitted — only relevant for a row
// that can be dropped onto, which this never is.
return [
  {
    id: `scenario-tabs-${i}`,
    endAt: item.key,
    legId: dayLegId,
    scenarioId,
    activityId: null,
    anchorEntityId: null,
    kind: 'after' as const,
    scenarioGroup: collectScenarioGroupMembers(item.tracks ?? []),
  },
];
```

Add `ScenarioTrack` to the existing `import type { Activity, SequenceItem, TripData }
from './types';` in `reorder.ts` (alongside `Transit` added in Task 4).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/model/reorder.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/model/reorder.ts src/model/reorder.test.ts
git commit -m "Give the scenario-tabs row a drag-source scenarioGroup payload"
```

---

## Task 6: `applyBlockReorder`

**Files:**

- Modify: `src/model/reorder.ts`
- Test: `src/model/reorder.test.ts`

**Interfaces:**

- Consumes: `resolveDropTiming`, `diffMinutesIso`/`addMinutesIso`.
- Produces: `applyBlockReorder(data: TripData, dropMeta: DragMeta, members: { activityIds: string[]; transitIds: string[] }, dayStart: string): TripData`.

- [ ] **Step 1: Write the failing tests**

Add a new `describe('applyBlockReorder', ...)` block to `src/model/reorder.test.ts`:

```ts
describe('applyBlockReorder', () => {
  function transit(overrides: Partial<EnrichedTransit>): EnrichedTransit {
    return {
      _id: 'transit1',
      legId: 'legA',
      journeyId: null,
      scenarioId: 'ideal',
      status: 'planning',
      mode: 'drive',
      from: { id: null, label: 'A' },
      to: { id: null, label: 'B' },
      departsAt: '2027-06-01T08:00',
      routeId: null,
      routeVariant: null,
      booking: null,
      images: [],
      routeInfo: null,
      arrivesAt: '2027-06-01T09:00',
      notes: [],
      hasWarningNote: false,
      ...overrides,
    };
  }

  it('shifts every member by the same delta, computed from the block’s earliest member', () => {
    const dropMeta: DragMeta = {
      id: 'scenario-tabs-0',
      index: 0,
      endAt: '2027-06-01T10:00', // the block's earliest member (transit1, 08:00) lands here
      containerDayStart: DAY_START,
      legId: 'legA',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({})],
      activities: [
        activity({ _id: 'idealAct', scenarioId: 'ideal', startAt: '2027-06-01T10:00' }),
        activity({ _id: 'altAct', scenarioId: 'alt', startAt: '2027-06-01T09:00' }),
        activity({ _id: 'bystander', scenarioId: null, startAt: '2027-06-01T20:00' }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyBlockReorder(
      data,
      dropMeta,
      { activityIds: ['idealAct', 'altAct'], transitIds: ['transit1'] },
      DAY_START,
    );
    const byId = (id: string) => next.activities.find((a) => a._id === id);
    const transitById = next.transits.find((t) => t._id === 'transit1');
    // delta = 10:00 - 08:00 = +120 minutes, applied to every member.
    expect(transitById?.departsAt).toBe('2027-06-01T10:00');
    expect(transitById?.arrivesAt).toBe('2027-06-01T11:00'); // duration preserved
    expect(byId('idealAct')?.startAt).toBe('2027-06-01T12:00');
    expect(byId('altAct')?.startAt).toBe('2027-06-01T11:00');
    expect(byId('bystander')?.startAt).toBe('2027-06-01T20:00'); // untouched — not a member
  });

  it('reassigns legId for every member but never touches scenarioId', () => {
    const dropMeta: DragMeta = {
      id: 'scenario-tabs-0',
      index: 0,
      endAt: '2027-06-01T10:00',
      containerDayStart: DAY_START,
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({ legId: 'legA' })],
      activities: [
        activity({
          _id: 'idealAct',
          legId: 'legA',
          scenarioId: 'ideal',
          startAt: '2027-06-01T08:00',
        }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyBlockReorder(
      data,
      dropMeta,
      { activityIds: ['idealAct'], transitIds: ['transit1'] },
      DAY_START,
    );
    const moved = next.activities.find((a) => a._id === 'idealAct');
    const movedTransit = next.transits.find((t) => t._id === 'transit1');
    expect(moved?.legId).toBe('legB');
    expect(moved?.scenarioId).toBe('ideal'); // untouched
    expect(movedTransit?.legId).toBe('legB');
  });

  it('reassigns legId even for a member with no real startAt to shift', () => {
    const dropMeta: DragMeta = {
      id: 'scenario-tabs-0',
      index: 0,
      endAt: '2027-06-01T10:00',
      containerDayStart: DAY_START,
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [transit({})],
      activities: [
        activity({
          _id: 'idealAct',
          legId: 'legA',
          scenarioId: 'ideal',
          startAt: '2027-06-01T08:00',
        }),
        activity({
          _id: 'fuzzyAct',
          legId: 'legA',
          scenarioId: 'ideal',
          startAt: null,
          timeLabel: 'Sometime',
        }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyBlockReorder(
      data,
      dropMeta,
      { activityIds: ['idealAct', 'fuzzyAct'], transitIds: ['transit1'] },
      DAY_START,
    );
    const fuzzy = next.activities.find((a) => a._id === 'fuzzyAct');
    expect(fuzzy?.legId).toBe('legB');
    expect(fuzzy?.startAt).toBeNull(); // no time to shift, but legId still moves
  });

  it('rebases the block onto a different calendar day when dropped there', () => {
    const dropMeta: DragMeta = {
      id: 'empty-2027-07-13',
      index: 0,
      endAt: null,
      containerDayStart: '2027-07-13T00:00',
      legId: 'legB',
      scenarioId: null,
      activityId: null,
      anchorEntityId: null,
      kind: 'after',
    };
    const data: TripData = {
      trip: { _id: 'trip', name: 'Trip', travelers: [], images: [] },
      legs: [],
      stays: [],
      transits: [],
      activities: [
        activity({
          _id: 'idealAct',
          legId: 'legA',
          scenarioId: 'ideal',
          startAt: '2027-06-01T08:00',
        }),
        activity({ _id: 'altAct', legId: 'legA', scenarioId: 'alt', startAt: '2027-06-01T09:00' }),
      ],
      scenarios: [],
      notes: [],
      routes: [],
    };
    const next = applyBlockReorder(
      data,
      dropMeta,
      { activityIds: ['idealAct', 'altAct'], transitIds: [] },
      '2027-07-13T00:00',
    );
    const byId = (id: string) => next.activities.find((a) => a._id === id);
    // No real anchor, but this crosses days — re-bases onto 2027-07-13,
    // keeping each member's own time-of-day and relative offset.
    expect(byId('idealAct')?.startAt).toBe('2027-07-13T08:00');
    expect(byId('altAct')?.startAt).toBe('2027-07-13T09:00');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/model/reorder.test.ts -t applyBlockReorder`
Expected: FAIL — `applyBlockReorder` is not exported.

- [ ] **Step 3: Implement `applyBlockReorder`**

Add to `src/model/reorder.ts`, after `applyTransitReorder`:

```ts
// Moves an entire scenario-group bundle (every Activity/Transit across every
// branch under one ScenarioTabsNode, gathered by collectScenarioGroupMembers
// above) as one rigid block: every member keeps its own relative offset from
// the rest of the block, and its own scenarioId (which branch it's in) —
// only legId reassigns, to the drop's destination leg. See the design
// spec's "Decisions" section for why scenarioId is deliberately never
// touched here, unlike a plain Activity drop. No cascade (see
// applyTransitReorder's own note on why).
export function applyBlockReorder(
  data: TripData,
  dropMeta: DragMeta,
  members: { activityIds: string[]; transitIds: string[] },
  dayStart: string,
): TripData {
  const activityIds = new Set(members.activityIds);
  const transitIds = new Set(members.transitIds);
  const memberActivities = data.activities.filter((a) => activityIds.has(a._id));
  const memberTransits = data.transits.filter((t) => transitIds.has(t._id));

  const times = [
    ...memberActivities.map((a) => a.startAt).filter((t): t is string => t !== null),
    ...memberTransits.map((t) => t.departsAt),
  ];
  if (!times.length) return data;
  const anchorTime = times.reduce((min, t) => (t < min ? t : min));

  const crossesDay = anchorTime.slice(0, 10) !== dayStart.slice(0, 10);
  const timing = resolveDropTiming(dropMeta.endAt, dayStart, anchorTime, crossesDay);
  const deltaMinutes = diffMinutesIso(anchorTime, timing.startAt);

  return {
    ...data,
    activities: data.activities.map((a) => {
      if (!activityIds.has(a._id)) return a;
      return {
        ...a,
        startAt: a.startAt ? addMinutesIso(a.startAt, deltaMinutes) : a.startAt,
        legId: dropMeta.legId,
      };
    }),
    transits: data.transits.map((t) => {
      if (!transitIds.has(t._id)) return t;
      return {
        ...t,
        departsAt: addMinutesIso(t.departsAt, deltaMinutes),
        arrivesAt:
          t.routeId || !t.arrivesAt ? t.arrivesAt : addMinutesIso(t.arrivesAt, deltaMinutes),
        legId: dropMeta.legId,
      };
    }),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/model/reorder.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add src/model/reorder.ts src/model/reorder.test.ts
git commit -m "Add applyBlockReorder for dragging a whole scenario-group bundle"
```

---

## Task 7: Wire the two new drag handles into `DayTimeline.tsx`

**Files:**

- Modify: `src/components/day/DayTimeline.tsx`

**Interfaces:**

- Consumes: `DragMeta.transitId`/`DragMeta.scenarioGroup` (Tasks 3, 5).
- Produces: a Depart row and a `ScenarioTabsNode` row that both render a drag handle and register as `useSortable` drag sources; the `ScenarioTabsNode` row is draggable but never droppable.

This task has no unit tests of its own (it's UI wiring over already-tested
`reorder.ts` logic) — verified via Task 9's manual browser check. Work through the
steps in order; each is small enough to sanity-check by reading the diff.

- [ ] **Step 1: Let `SortableRow` control droppable independently of draggable**

In `src/components/day/DayTimeline.tsx`, change `SortableRow`'s signature (currently
around lines 488-514):

```ts
function SortableRow({
  dragId,
  disabled,
  droppable = true,
  dragMeta,
  children,
}: {
  dragId: string;
  disabled: boolean;
  droppable?: boolean;
  dragMeta?: DragMeta;
  children: (
    dragHandleProps: {
      attributes: ReturnType<typeof useSortable>['attributes'];
      listeners: ReturnType<typeof useSortable>['listeners'];
    } | null,
    isOver: boolean,
  ) => ReactElement;
}) {
  const { setNodeRef, transform, transition, attributes, listeners, isDragging, isOver } =
    useSortable({
      id: dragId,
      disabled: { draggable: disabled, droppable: !droppable },
      data: dragMeta,
    });
```

(Everything below that `useSortable` call in the function body is unchanged.)

- [ ] **Step 2: Add `droppable` to `DayTimelineNode` and set it per row type**

In the `DayTimelineNode` interface (currently around lines 646-651), add `droppable:
boolean;` next to `draggable: boolean;`.

Set `droppable: true` on every existing branch's node object (`stay`,
`transit-boundary`, `transit-stage`, `section`) — these are unchanged from today's
behavior. In the `morningStayNodes` mapping further down (currently around lines
748-757), add `droppable: false,` (that row was already `dragId: null`, i.e. never
wired into `SortableRow` at all — this field is unread for it, but keep the interface
satisfied).

- [ ] **Step 3: Make the Depart row draggable, and pass it a `dragHandle`**

Change `TransitBoundaryNode`'s props (currently around lines 264-272) to accept a
`dragHandle`:

```ts
const TransitBoundaryNode = memo(function TransitBoundaryNode({
  item,
  isLast,
  onOpen,
  dragHandle,
}: {
  item: TransitBoundarySequenceItem;
  isLast: boolean;
  onOpen: (transit: EnrichedTransit) => void;
  dragHandle?: ReactNode;
}) {
```

Pass it through to `TimelineRow` (currently the `<TimelineRow dot={...} isLast={isLast} trailing={...}>` opening tag around line 306): add `dragHandle={dragHandle}` as a prop on that element.

In `DayTimeline`'s node-building `flatMap` (currently around lines 671-683), change
the `'transit-boundary'` branch:

```ts
    if (item.type === 'transit-boundary') {
      const dragId = `transit-${item.transit._id}-${item.phase}`;
      return [
        {
          key: dragId,
          dragId,
          draggable: item.phase === 'depart',
          droppable: true,
          render: (isLast: boolean, dragHandle?: ReactNode) => (
            <TransitBoundaryNode
              item={item}
              isLast={isLast}
              onOpen={onOpenTransit}
              dragHandle={item.phase === 'depart' ? dragHandle : undefined}
            />
          ),
        },
      ];
    }
```

- [ ] **Step 4: Make the `scenario-tabs` row a (non-droppable) drag source**

Change `ScenarioTabsNode`'s props (currently around lines 421-439) to accept a
`dragHandle`:

```ts
const ScenarioTabsNode = memo(function ScenarioTabsNode({
  day,
  tracks,
  topLevel,
  isLast,
  daysByDate,
  onOpenActivity,
  onOpenStay,
  onOpenTransit,
  dragHandle,
}: {
  day: Day;
  tracks: ScenarioTrack[];
  topLevel: boolean;
  isLast: boolean;
  daysByDate: Map<string, Day>;
  onOpenActivity: (activity: EnrichedActivity, selectedOption?: EnrichedMealOption) => void;
  onOpenStay: (stay: EnrichedStay) => void;
  onOpenTransit: (transit: EnrichedTransit) => void;
  dragHandle?: ReactNode;
}) {
```

Add `dragHandle={dragHandle}` to its `<TimelineRow dot={...} isLast={isLast}
contentSx={{ pb: 0, px: 0 }}>` opening tag (currently around line 451).

In `DayTimeline`'s node-building `flatMap`, change the final `// scenario-tabs`
branch (currently around lines 716-734):

```ts
    // scenario-tabs
    const scenarioDragId = `scenario-tabs-${i}`;
    return [
      {
        key: scenarioDragId,
        dragId: scenarioDragId,
        draggable: true,
        droppable: false,
        render: (isLast: boolean, dragHandle?: ReactNode) => (
          <ScenarioTabsNode
            day={day}
            tracks={item.tracks ?? day.scenarioTracks}
            topLevel={!item.tracks}
            isLast={isLast}
            daysByDate={daysByDate}
            onOpenActivity={onOpenActivity}
            onOpenStay={onOpenStay}
            onOpenTransit={onOpenTransit}
            dragHandle={dragHandle}
          />
        ),
      },
    ];
```

(This `scenario-tabs-${i}` id must match `buildDragMeta`'s own `id: `scenario-tabs-${i}`` from Task 5 exactly — both index off the same `flattened` array position, so they already agree without further changes.)

- [ ] **Step 5: Update the render loop to pass `droppable` and to skip the click-to-select behavior for non-Activity handles**

Replace the final render block (currently around lines 787-835):

```tsx
{
  allNodes.map((node, i) => {
    const meta = node.dragId ? dragMetaById.get(node.dragId) : undefined;
    const activityId = meta?.activityId ?? null;
    const isSelected = Boolean(activityId && isActivitySelected(selection, activityId));
    return (
      <Fragment key={node.key}>
        {node.dragId ? (
          <SortableRow
            dragId={node.dragId}
            disabled={!node.draggable}
            droppable={node.droppable}
            dragMeta={meta}
          >
            {(dragHandleProps) =>
              node.render(
                i === allNodes.length - 1,
                dragHandleProps ? (
                  <Tooltip
                    title={
                      !activityId
                        ? 'Drag to reorder'
                        : isSelected
                          ? 'Selected — drag to move group'
                          : 'Drag to reorder'
                    }
                  >
                    <IconButton
                      className={DRAG_HANDLE_HOVER_CLASS}
                      size="small"
                      aria-label={
                        activityId && isSelected ? 'Selected, drag to move group' : 'Reorder'
                      }
                      color={activityId && isSelected ? 'primary' : 'default'}
                      onClick={
                        activityId
                          ? (event) => {
                              event.stopPropagation();
                              toggleActivitySelection(containerId, activityId);
                            }
                          : undefined
                      }
                      sx={{
                        flexShrink: 0,
                        cursor: 'grab',
                        touchAction: 'none',
                        opacity: activityId && isSelected ? 1 : 0,
                        transition: 'opacity 0.15s',
                        p: `${DRAG_HANDLE_PADDING_PX}px`,
                      }}
                      {...dragHandleProps.attributes}
                      {...dragHandleProps.listeners}
                    >
                      <DragIndicatorIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                ) : undefined,
                isSelected,
              )
            }
          </SortableRow>
        ) : (
          node.render(i === allNodes.length - 1)
        )}
      </Fragment>
    );
  });
}
```

(Behavior for Activity rows is unchanged — `activityId` is still populated exactly as
before, so the tooltip/aria-label/color/onClick/opacity ternaries all resolve
identically for them. A Transit Depart row or the scenario-tabs row now gets the same
handle, minus the click-to-toggle-select affordance, matching the design spec's "out
of scope: manually multi-selecting Transits" and the fact that a scenario-group drag
is never manually toggled either.)

- [ ] **Step 6: Run the existing test suite (regression check — this task has no new tests of its own)**

Run: `npx vitest run`
Expected: PASS (all suites — this task only touches rendering wiring, not any tested
logic)

- [ ] **Step 7: Commit**

```bash
git add src/components/day/DayTimeline.tsx
git commit -m "Wire drag handles for a Transit's Depart row and the scenario-tabs row"
```

---

## Task 8: Handle the two new drags in `DaysView.tsx`

**Files:**

- Modify: `src/routes/DaysView.tsx`

**Interfaces:**

- Consumes: `applyTransitReorder`, `applyBlockReorder` (Tasks 4, 6).

- [ ] **Step 1: Import the two new functions**

In `src/routes/DaysView.tsx`, change the existing import:

```ts
import { applyActivityReorder, applyGroupActivityReorder, type DragMeta } from '../model/reorder';
```

to:

```ts
import {
  applyActivityReorder,
  applyBlockReorder,
  applyGroupActivityReorder,
  applyTransitReorder,
  type DragMeta,
} from '../model/reorder';
```

- [ ] **Step 2: Track the full dragged `DragMeta`, not just an activity id**

Replace the existing `draggingId`/`draggingActivity`/`draggingGroupSize` state and
derivations (currently around lines 184-201) with:

```ts
const [draggingMeta, setDraggingMeta] = useState<DragMeta | null>(null);
const draggingActivity = draggingMeta?.activityId
  ? (data?.activities.find((a) => a._id === draggingMeta.activityId) ?? null)
  : null;
const draggingTransit = draggingMeta?.transitId
  ? (data?.transits.find((t) => t._id === draggingMeta.transitId) ?? null)
  : null;
const draggingScenarioGroup = draggingMeta?.scenarioGroup ?? null;
// Whether the dragged row is part of a multi-select of more than one
// Activity (see ActivitySelectionValue) — selection is untouched for the
// whole drag (only cleared once handleDragEnd's group branch commits), so
// this can be derived straight from current state rather than snapshotted
// at drag-start.
const draggingGroupSize =
  draggingMeta?.activityId &&
  selection &&
  selection.ids.has(draggingMeta.activityId) &&
  selection.ids.size > 1
    ? selection.ids.size
    : null;

const handleDragStart = (event: DragStartEvent) => {
  setDraggingMeta((event.active.data.current as DragMeta | undefined) ?? null);
};
```

- [ ] **Step 3: Add the two new branches to `handleDragEnd`**

Replace `handleDragEnd`'s body (currently lines 233-285) with:

```ts
const handleDragEnd = (event: DragEndEvent) => {
  setDraggingMeta(null);
  const { active, over } = event;
  if (!over || active.id === over.id) return;
  const activeMeta = active.data.current as DragMeta | undefined;
  const overMeta = over.data.current as DragMeta | undefined;
  if (!activeMeta || !overMeta) return;
  const activeContainerId = containerIdOf(active.data.current);
  const overContainerId = containerIdOf(over.data.current);
  const containerChanged = activeContainerId !== overContainerId;
  const preserveOwnTiming =
    containerChanged && dayOfContainer(activeContainerId) === dayOfContainer(overContainerId);
  const movingUp = !containerChanged && activeMeta.index > overMeta.index;
  const dropMeta: DragMeta =
    movingUp && overMeta.before ? { ...overMeta, ...overMeta.before } : overMeta;
  const dayStart = dropMeta.containerDayStart;

  if (activeMeta.scenarioGroup) {
    const members = activeMeta.scenarioGroup;
    setData(
      (prev) => applyBlockReorder(prev, dropMeta, members, dayStart),
      ['activities', 'transits'],
    );
    return;
  }

  if (activeMeta.transitId) {
    const transitId = activeMeta.transitId;
    setData(
      (prev) => applyTransitReorder(prev, dropMeta, transitId, dayStart, preserveOwnTiming),
      ['transits'],
    );
    return;
  }

  if (!activeMeta.activityId) return;
  const activityId = activeMeta.activityId;
  const isGroupDrag = isActivitySelected(selection, activityId) && (selection?.ids.size ?? 0) > 1;
  if (isGroupDrag && selection && data) {
    const groupIds = data.activities
      .filter((a) => selection.ids.has(a._id))
      .sort((a, b) => activitySortKey(a, dayStart).localeCompare(activitySortKey(b, dayStart)))
      .map((a) => a._id);
    setData(
      (prev) =>
        applyGroupActivityReorder(prev, dropMeta, groupIds, dayStart, (id) => {
          const originContainerId = selection.ids.get(id);
          return (
            originContainerId !== overContainerId &&
            dayOfContainer(originContainerId) === dayOfContainer(overContainerId)
          );
        }),
      ['activities'],
    );
    clearActivitySelection();
    return;
  }
  setData(
    (prev) => applyActivityReorder(prev, dropMeta, activityId, dayStart, preserveOwnTiming),
    ['activities'],
  );
};
```

(The group-Activity and single-Activity branches are unchanged from today — only the
top-of-function guard and the two new early-return branches above them are new.)

- [ ] **Step 4: Extend the `DragOverlay` with the two new cases**

Replace the `<DragOverlay>` block (currently lines 351-370):

```tsx
<DragOverlay>
  {draggingActivity && (
    <Paper elevation={3} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
      <DragIndicatorIcon fontSize="small" color="action" />
      <Box>
        <Typography variant="subtitle2">
          {draggingGroupSize ? `${draggingGroupSize} activities` : draggingActivity.text}
        </Typography>
        {!draggingGroupSize && draggingActivity.startAt && (
          <Typography variant="caption" color="text.secondary">
            {formatTime(draggingActivity.startAt)}
          </Typography>
        )}
      </Box>
    </Paper>
  )}
  {draggingTransit && (
    <Paper elevation={3} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
      <DragIndicatorIcon fontSize="small" color="action" />
      <Typography variant="subtitle2">
        {draggingTransit.from.label} → {draggingTransit.to.label}
      </Typography>
    </Paper>
  )}
  {draggingScenarioGroup && (
    <Paper elevation={3} sx={{ display: 'flex', alignItems: 'center', gap: 1, px: 1.5, py: 1 }}>
      <DragIndicatorIcon fontSize="small" color="action" />
      <Typography variant="subtitle2">
        {draggingScenarioGroup.activityIds.length + draggingScenarioGroup.transitIds.length} items
      </Typography>
    </Paper>
  )}
</DragOverlay>
```

- [ ] **Step 5: Typecheck and run the full test suite**

Run: `npx tsc -b --noEmit && npx vitest run`
Expected: no TypeScript errors, all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/routes/DaysView.tsx
git commit -m "Handle Transit and scenario-group drags in DaysView's handleDragEnd"
```

---

## Task 9: Manual verification and final validation

**Files:** none (verification only)

- [ ] **Step 1: Start the dev server**

Run: `npm run dev` (in the background, or reuse an already-running one — do not kill
an existing dev server between testing rounds).

- [ ] **Step 2: Manually verify a Transit drag**

In the browser, open a day with a Transit. Hover the Depart row — a drag handle
should appear (matching an Activity row's own hover-reveal handle). Drag it to a new
position later in the same day; confirm:

- The Transit's Depart time updates to the drop position.
- If it's a routed drive, the stage times/arrival shift accordingly (recomputed).
- If it's an unrouted Transit (e.g. a flight), its own duration is preserved.
- Dropping it into a different leg's day changes which leg it now belongs to.

- [ ] **Step 3: Manually verify a scenario-group drag**

Open a day with an ideal/alternate scenario split. Hover the scenario-tabs section's
own row (the "alt_route" icon row) — a drag handle should appear there too. Drag it
to a new position; confirm every Activity/Transit across both branches shifts by the
same amount, staying in their original branches (switching tabs still shows the same
ideal/alternate split, just at new times).

- [ ] **Step 4: Confirm existing Activity drag/multi-select still works**

Drag a single Activity, and a multi-selected group of Activities (click their drag
handles to select, then drag one) — confirm both still work exactly as before this
plan's changes.

- [ ] **Step 5: Run the full validation suite**

Run: `npm run validate`
Expected: lint, format check, all tests, and `tsc -b` all pass with no errors.

- [ ] **Step 6: Report back**

Summarize what was manually verified (or any issue found) — no commit for this task
unless Step 5 turned up something to fix, in which case fix it, re-run `npm run
validate`, and commit that fix separately with a message describing what was wrong.

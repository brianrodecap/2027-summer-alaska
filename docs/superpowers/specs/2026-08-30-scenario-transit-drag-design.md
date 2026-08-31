# Scenario-group and Transit drag — design

## Context

`src/model/reorder.ts` + `src/components/day/DayTimeline.tsx` + `src/routes/DaysView.tsx`
already implement drag-and-drop reordering for individual Activity rows (single-drag,
and a manual multi-select drag via a toggleable handle — see `reorder.test.ts` and
`ActivitySelection` in `TripSelectionsContextObject.ts`). Stay and Transit rows are
currently fixed anchors: droppable (an Activity can land immediately before/after
them) but never themselves draggable, and a `scenario-tabs` row (the ideal/alternate
tab section) is excluded from drag targeting entirely — see `reorder.ts`'s own
top-of-file and `buildDragMeta` comments.

This adds two new drag _sources_, on top of the existing Activity behavior, which is
unchanged:

1. **Transit** — draggable via a handle on its Depart row only.
2. **Scenario group** — draggable via a handle on the `ScenarioTabsNode` row; grabbing
   it always drags the _entire_ bundle under that node (every branch: ideal,
   alternate, and any nested children scenarios — see `buildScenarioTracks`'s
   `parentScenarioId` nesting — plus every Activity and Transit any of those branches
   contain, for that rendered day).

## Decisions (confirmed with the user)

- **Scenario-group moves shift as one rigid block**, not a flatten-and-resequence:
  every member's own relative time offset from the rest of the block is preserved.
  Concretely, one `deltaMinutes` is computed from the block's earliest member's old
  time vs. its new dropped time, and every member shifts by that same delta.
- **`scenarioId` is never reassigned by a scenario-group drag.** Every member keeps
  its own original branch — that's what "shift as one block" means for a bundle that
  spans multiple scenarios by definition. Reassigning would silently collapse
  ideal/alternate/nested branches into one on drop.
- **`legId` _is_ reassigned** ("full reassignment") for both new gestures: dropping a
  Transit or a scenario-group block onto a different leg's day reassigns every moved
  entity to that leg, the same as an Activity drag already does.
- **Cross-day is allowed** for both: a Transit or a scenario-group block can be
  dragged onto a different calendar day, reusing the exact `crossesDay` /
  `preserveOwnTiming` / `dayOfContainer` machinery Activities already use.
- **Scenario-group drops only target real top-level-day anchor positions** — never a
  position inside a _different single_ scenario tab. Dropping a multi-branch bundle
  into one specific scenario tab would force a `scenarioId` collapse, which the
  previous decision rules out. (Dropping it back into empty space within its own
  original tab, or onto the top-level list, or onto a different day, are all valid.)
- **No new auto-cascade for v1.** The existing Activity-cascade (pushing later
  Activities out of the way of a drop) is untouched for the existing gestures. The
  two new gestures do **not** push bystanders out of the way at the drop point — a
  dropped Transit or scenario-block can end up time-overlapping something already
  there, same as a manual edit through `EditDialog` already can today. Full mutual
  cascade across activities/transits/blocks is out of scope here.

## `src/model/reorder.ts` changes

### `DragMeta`

- `anchorActivityId: string | null` is replaced by `anchorEntityId: { kind: 'activity' | 'transit'; id: string } | null` — every existing use (the tie-break / array-position anchor) is Activity-only today; generalizing it is what lets a dropped Transit resolve its own array position the same way. Every current call site that reads/writes `anchorActivityId` is updated to construct/read `{ kind: 'activity', id }`.
- New optional `transitId: string | null` on a Depart row's DragMeta (mirrors `activityId`), so `DaysView.handleDragEnd` can tell a Transit drag apart from an Activity drag.
- New DragMeta variant for a scenario-tabs row: `scenarioGroup: { activityIds: string[]; transitIds: string[] } | null`. Only ever populated on the one DragMeta entry built for a `{ type: 'scenario-tabs' }` sequence item (previously skipped by `buildDragMeta` entirely — see its existing `return []; // scenario-tabs` branch). Computed by recursing through `tracks` (and each track's own nested `{ type: 'scenario-tabs', tracks }` child, matching `buildScenarioTracks`'s own nesting) and collecting every Activity/Transit id present in any of those tracks' `sequence`.
- `kind: 'after' | 'day-start' | 'front-takeover'` is unchanged; the scenario-tabs row's own DragMeta always uses `'after'` (no day-start equivalent — a scenario-group block never takes over the literal front of the day the way Check-out's cascade does, matching "no new auto-cascade").

### `buildRealAnchors` / `buildDragMeta`

- The Depart row's `draggable` flag flips from its current hardcoded exclusion to `true` — `TransitBoundaryNode` phase `'depart'` becomes a real drag source. Arrive and stage rows are unchanged (never draggable).
- The `scenario-tabs` branch of `buildDragMeta`'s main `flatMap` — currently `return [];` — instead returns one real DragMeta entry (`id: scenario-tabs-${i}`, matching `DayTimeline.tsx`'s existing node key for that row), draggable, carrying the new `scenarioGroup` field. It is **not** wired as a drop target: today this row has no DragMeta/dragId at all, so it's neither a drag source nor a drop target; it becomes `{ draggable: true, droppable: false }` — draggable, but explicitly never a drop target, the inverse of Stay/Transit's existing `{ draggable: false, droppable: true }`. See "DayTimeline.tsx changes" below for exactly how.

### New functions

- **`applyTransitReorder(data, dropMeta, transitId, dayStart, preserveOwnTiming)`** — mirrors `applyActivityReorder`'s shape, operating on `data.transits`:
  - Resolves the new `departsAt` via the same `resolveDropTiming` helper already used for Activities.
  - If the transit is unrouted (`arrivesAt` explicit, `routeId` null): shifts `arrivesAt` by the same delta as `departsAt` (`newArrivesAt - oldDepartsAt == oldArrivesAt - ... ` i.e. preserves the authored duration). If routed, `arrivesAt`/stage times are left alone — `buildTripView`'s existing route-walk already recomputes them from the new `departsAt` at render time, nothing to do here.
  - Sets `legId`/`scenarioId` from `dropMeta`.
  - Repositions the Transit in `data.transits` using `dropMeta.anchorEntityId`, same "insert immediately after" rule `applyActivityReorder` already uses for Activities.
  - No cascade (see "No new auto-cascade" above).
- **`applyBlockReorder(data, dropMeta, members: { activityIds: string[]; transitIds: string[] }, dayStart)`** — the scenario-group block move:
  - Computes the block's current anchor time: the earliest of every member's own current time (`startAt` for Activities via `activitySortKey`, `departsAt` for Transits).
  - Resolves the block's new anchor time via `resolveDropTiming` against `dropMeta`, same as a single drop.
  - `deltaMinutes = ` new anchor time − old anchor time, via a new small helper `diffMinutesIso(a, b)` in `tripModel.ts` (built on the existing `wallClockMs`, alongside `addMinutesIso` — `(wallClockMs(b) - wallClockMs(a)) / 60000`).
  - Every member shifts by `deltaMinutes`: `addMinutesIso(startAt, deltaMinutes)` for Activities, `addMinutesIso(departsAt, deltaMinutes)` (+ same shift to `arrivesAt` when unrouted) for Transits.
  - Every member's `legId` is set to `dropMeta.legId`. **No member's `scenarioId` is touched.**
  - No array-position anchoring beyond what naturally falls out of each member's own new timestamp — the block doesn't need `anchorEntityId`-style tie-breaking the way a same-instant single drop does, since a whole day's worth of distinct timestamps essentially never collide after a uniform shift.
- **`diffMinutesIso(a: string, b: string): number`** — small addition to `tripModel.ts` next to `addMinutesIso`.

## `src/components/day/DayTimeline.tsx` changes

- `TransitBoundaryNode`: when `isDepart`, render the same hover-reveal drag-handle `IconButton` (`DragIndicatorIcon`, `touchAction: 'none'`) the `ActivityNode` row already renders, wired the same way (`SortableRow`'s render-prop `dragHandleProps`). Arrive stays exactly as today (no handle).
- `ScenarioTabsNode`: gains the same handle. Its `SortableRow` wraps it with `disabled: { draggable: false, droppable: true }` inverted — concretely, `SortableRow`'s existing `disabled` prop (today a single boolean driving both `draggable`/`droppable` via `!node.draggable`) needs to accept the drag/drop-ability independently for this one row type, since it must be draggable but explicitly _not_ droppable (per "scenario-group drops only target real top-level-day anchor positions", it should never absorb a drop the way an Activity/Transit anchor row does). The `DayTimelineNode` interface's `draggable: boolean` becomes `draggable: boolean; droppable: boolean` (defaulting `droppable: draggable` everywhere except this one new case).
- `DragMeta` lookups (`node.dragId ? dragMetaById.get(node.dragId) : undefined`) already work unchanged once the scenario-tabs row gets a real `dragId`.

## `src/routes/DaysView.tsx` changes

`handleDragEnd` gains two new branches (checked before the existing Activity-only logic, based on which field is populated on `activeMeta`):

- `activeMeta.transitId` set → `applyTransitReorder`, using the exact same `preserveOwnTiming`/`crossesDay`/`dayOfContainer` derivation the Activity branch already computes (generalized to not assume `activityId`).
- `activeMeta.scenarioGroup` set → `applyBlockReorder`, passing `activeMeta.scenarioGroup` straight through as `members`. `preserveOwnTiming`/`crossesDay` still apply to resolving the block's _anchor_ drop time (via the same `dropMeta`/`overMeta` logic), but are irrelevant per-member — `applyBlockReorder` shifts every member uniformly rather than resolving each one's timing independently.

`DragOverlay` gains two new render cases (currently only shows the dragged Activity/group-count):

- Dragging a Transit: shows its `from.label → to.label`.
- Dragging a scenario-group block: shows a count, e.g. "`N` activities across `M` branches".

## Explicitly out of scope for this pass

- Cascading bystanders out of the way of a dropped Transit or scenario-group block.
- Manually multi-selecting Transits into the existing Activity multi-select gesture (`ActivitySelection`) — Transit dragging is its own single-gesture drag, not foldable into the toggle-select mechanism.
- Any change to how a scenario-group's own position (`anchorKey`) is _computed_ for rendering — that stays fully derived from its content's earliest timestamp, exactly as today; dragging only changes what that content's timestamps are.

## Testing

`reorder.test.ts` (synthetic fixtures only — no `loadRealTripData()`) gets new cases
for both new functions: `applyTransitReorder` (routed vs. unrouted `arrivesAt`
handling, legId/scenarioId reassignment, cross-day rebasing) and `applyBlockReorder`
(delta computed correctly from the earliest member, every member shifted by the same
delta, `scenarioId` never touched, `legId` reassigned for every member, nested child
scenario tracks' members included).

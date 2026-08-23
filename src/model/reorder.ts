// Drag-and-drop reordering for the day list's Activity rows (see
// DayTimeline.tsx). Only Activities are ever picked up and moved — Stay
// check-in/out and Transit depart/arrive/stages stay fixed anchors, since
// they aren't independent authored entities the way an Activity's own
// startAt/durationMinutes is. Dropping an Activity onto a new position
// rewrites its startAt (anchored to whatever now sits immediately before
// it — its durationMinutes is untouched, since duration is independent of
// position under this model) and its legId/scenarioId (matched to that
// same position), so a drag across a leg-transition day or into a
// different scenario tab never leaves a stale legId/scenarioId behind.

import { activityDurationMinutes, activitySortKey, addMinutesIso } from './tripModel';
import type { Activity, SequenceItem, TripData } from './types';

type ActivityTiming = Pick<
  Activity,
  '_id' | 'startAt' | 'timeLabel' | 'durationMinutes' | 'mealType' | 'diningFormat' | 'options'
>;

// An anchor row's own end-of-event moment — what a dropped Activity lands
// on immediately after. An Activity with a real duration (explicit, or a
// meal's mealType/diningFormat estimate — activityDurationMinutes) falls
// strictly after that activity's own day.sequence sort key (startAt); one
// with no real duration to lend reports the same instant as its own sort
// key, same as a Stay/Transit boundary or stage always does (those are
// inherently instantaneous). Landing a dropped Activity exactly on that
// shared instant is fine — see DragMeta's own note below for how the
// resulting tie actually gets resolved in the dragged Activity's favor,
// without needing to nudge the anchor's own timestamp at all.
function activityAnchorEndAt(activity: ActivityTiming, dayStart: string): string {
  if (!activity.startAt) return activitySortKey(activity, dayStart);
  return activityEndAt(activity.startAt, activity);
}

// One entry per row DayTimeline actually renders (Stay/Transit boundary or
// stage, or an Activity) — the same set of rows that can catch a drop.
// A `scenario-tabs` row is skipped entirely: it's a whole nested
// sub-timeline, not a single point in time, so it isn't a valid drop
// anchor — the nearest real row above or below still is.
//
// A dropped Activity landing exactly on its anchor's own instant (a
// Stay/Transit boundary/stage, or another Activity with no lendable
// duration) needs day.sequence's stable sort (tripModel.ts's mergeByTime)
// to break that tie in the dropped Activity's favor, not leave it looking
// like nothing happened. mergeByTime's own tie-break is array order — the
// day's pre-sort items are built stays-then-transits-then-activities, so a
// tie against a Stay/Transit boundary already resolves correctly for free
// (that group always sorts first). A tie against another Activity doesn't,
// though, since applyActivityReorder (below) never used to change *where*
// the dragged entry sits in TripData.activities, only its own startAt —
// `anchorActivityId` is what fixes that at the root: when set, it names
// the specific Activity the dropped one should be moved to sit immediately
// after in the array, so an exact-timestamp tie against that same Activity
// resolves the same way group order already does for Stay/Transit.
//
// `kind` distinguishes the one drop position that isn't a simple "insert
// after this row": a Stay's Check-out row. Check-out/Check-in always
// render first/last in the day regardless of their own clock time
// (tripModel.ts's splitOutStayBoundaries), so their own checkOutAt/
// checkInAt isn't a meaningful "what comes right before/after this"
// anchor the way a real Activity/Transit's is —
//   - Check-in ("make this the last thing today") still uses `kind:
//     'after'`, just anchored to the day's own real last Activity/Transit
//     instead of checkInAt.
//   - Check-out ("make this the first thing today") is `kind: 'day-start'`:
//     `endAt` here is the *exact* startAt to hand the dropped Activity
//     (whatever the day's previously-first real Activity used to start
//     at), and `cascadeActivityIds` lists that Activity and every one
//     chronologically after it (in this same container) — each shifted
//     later by the dropped Activity's own duration so nothing collides
//     with the time it just took over. Transit/Stay entities are never
//     part of that cascade; they're fixed anchors, same as everywhere else
//     in this file.
//
// `cascadeActivityIds` is populated the same way for an ordinary `kind:
// 'after'` drop too — every real (non-Transit/Stay) Activity chronologically
// after this anchor position — but applyActivityReorder walks it with a
// different rule there: a mid-day drop only just created one collision (the
// dropped Activity now occupies time the next Activity used to start
// during), so only that immediate overlap needs resolving, pushed later
// exactly enough to clear it; the moment a downstream Activity's own
// startAt already lands at or after that point, the walk stops — nothing
// genuinely later needs to move, unlike a day-start drop's blanket shift of
// everything by the same fixed amount.
// dnd-kit's own `over` only ever names the row a drag is currently
// hovering, never "above" or "below" it — so a DragMeta by itself is
// ambiguous between the two. `index` (this row's position among every
// DragMeta in the same container, matching render order) is what
// DaysView.tsx's handleDragEnd compares against the dragged row's own
// index to tell them apart: dragging downward (dropped row's index below
// where the dragged Activity started) keeps the plain "insert after this
// row" fields above; dragging upward instead needs `before` —
// the equivalent placement anchored to whatever real row precedes this one
// instead, with the cascade chain starting at this row itself (inclusive)
// rather than after it. Only populated for a real anchor (Transit
// boundary/stage, or an Activity) — Check-out/Check-in already have no
// meaningful "before" distinct from their own `kind`-driven placement (nothing
// legitimately goes before Check-out; "before Check-in" is just "after the
// day's real last item," which Check-in's own fields already are), so it's
// left undefined and DaysView.tsx's direction check falls back to the plain
// fields in that case.
export interface DragMeta {
  id: string;
  index: number;
  endAt: string;
  legId: string;
  scenarioId: string | null;
  activityId: string | null;
  anchorActivityId: string | null;
  kind: 'after' | 'day-start';
  cascadeActivityIds?: string[];
  before?: {
    endAt: string;
    legId: string;
    anchorActivityId: string | null;
    cascadeActivityIds: string[];
  };
}

interface RealAnchor {
  endAt: string;
  legId: string;
  activityId: string | null;
  activityStartAt: string | null;
}

// The container's own real (non-Stay-boundary) rows, in day.sequence's
// true chronological order — what Check-out/Check-in's own drop targets
// (above) resolve against, since they're excluded from this list even
// though they're physically first/last in `flattened`.
function buildRealAnchors(flattened: SequenceItem[], dayStart: string): RealAnchor[] {
  const anchors: RealAnchor[] = [];
  for (const item of flattened) {
    if (item.type === 'transit-boundary' || item.type === 'transit-stage') {
      anchors.push({
        endAt: item.key,
        legId: item.transit.legId,
        activityId: null,
        activityStartAt: null,
      });
    } else if (item.type === 'section') {
      for (const activity of item.activities) {
        anchors.push({
          endAt: activityAnchorEndAt(activity, dayStart),
          legId: activity.legId,
          activityId: activity._id,
          activityStartAt: activity.startAt,
        });
      }
    }
  }
  return anchors;
}

// `id` mirrors DayTimeline's own node-key scheme exactly (same source
// array, same index) so a rendered row and its DragMeta always share one id
// — that's what lets a dnd-kit sortable id resolve straight back to this.
export function buildDragMeta(
  flattened: SequenceItem[],
  scenarioId: string | null,
  dayStart: string,
): DragMeta[] {
  const realAnchors = buildRealAnchors(flattened, dayStart);
  const firstActivityIdx = realAnchors.findIndex((a) => a.activityId !== null);
  const lastAnchor = realAnchors[realAnchors.length - 1] ?? null;

  // Every real Activity chronologically after `fromIdx` in `realAnchors` —
  // shared by every `kind: 'after'` anchor below (and by Check-out's own
  // `kind: 'day-start'` cascade, which starts from firstActivityIdx
  // instead), so both cascade rules in applyActivityReorder start from the
  // same downstream list.
  const downstreamActivityIds = (fromIdx: number): string[] =>
    realAnchors
      .slice(fromIdx)
      .map((a) => a.activityId)
      .filter((activityId): activityId is string => activityId !== null);

  // Tracks this anchor's own position within `realAnchors` as `flattened` is
  // walked — incremented in lockstep with buildRealAnchors' own iteration
  // (one bump per transit-boundary/transit-stage, one per section Activity,
  // none for a Stay row, since Stays never get pushed into realAnchors).
  let realAnchorIdx = -1;

  // The `before*` fields for the real anchor sitting at `realAnchors[k]` —
  // whatever real anchor precedes it, plus a cascade chain that starts at
  // `k` itself (inclusive) rather than after it, since "insert before this
  // row" means this row is exactly what has to move out of the way. `k`
  // being the very first real anchor (nothing precedes it at all) falls
  // back to that row's own start instant — its own startAt for an Activity,
  // or its own instantaneous key for a Transit boundary/stage — so the
  // dropped Activity takes over the slot outright, the same way Check-out's
  // day-start `endAt` takes over the previously-first Activity's own
  // startAt rather than snapping to the container's literal midnight.
  const beforeFieldsAt = (k: number, ownLegId: string): Pick<DragMeta, 'before'> => {
    const preceding = k > 0 ? realAnchors[k - 1] : null;
    const own = realAnchors[k];
    return {
      before: {
        endAt: preceding?.endAt ?? own.activityStartAt ?? own.endAt,
        legId: preceding?.legId ?? ownLegId,
        anchorActivityId: preceding?.activityId ?? null,
        cascadeActivityIds: downstreamActivityIds(k),
      },
    };
  };

  return flattened
    .flatMap((item, i): Array<Omit<DragMeta, 'index'>> => {
      if (item.type === 'stay') {
        const id = `stay-${item.stay._id}-${i}`;
        if (item.relation === 'Check out') {
          const first = firstActivityIdx >= 0 ? realAnchors[firstActivityIdx] : null;
          return [
            {
              id,
              endAt: first?.activityStartAt ?? dayStart,
              legId: first?.legId ?? item.stay.legId,
              scenarioId,
              activityId: null,
              anchorActivityId: null,
              kind: 'day-start',
              cascadeActivityIds:
                firstActivityIdx >= 0 ? downstreamActivityIds(firstActivityIdx) : [],
            },
          ];
        }
        if (item.relation === 'Check in') {
          return [
            {
              id,
              endAt: lastAnchor?.endAt ?? dayStart,
              legId: lastAnchor?.legId ?? item.stay.legId,
              scenarioId,
              activityId: null,
              anchorActivityId: lastAnchor?.activityId ?? null,
              kind: 'after',
              cascadeActivityIds: [], // Check-in is always last — nothing follows it
            },
          ];
        }
        return [
          {
            id,
            endAt: item.key,
            legId: item.stay.legId,
            scenarioId,
            activityId: null,
            anchorActivityId: null,
            kind: 'after',
          },
        ];
      }
      if (item.type === 'transit-boundary') {
        realAnchorIdx += 1;
        return [
          {
            id: `transit-${item.transit._id}-${item.phase}`,
            endAt: item.key,
            legId: item.transit.legId,
            scenarioId,
            activityId: null,
            anchorActivityId: null,
            kind: 'after',
            cascadeActivityIds: downstreamActivityIds(realAnchorIdx + 1),
            ...beforeFieldsAt(realAnchorIdx, item.transit.legId),
          },
        ];
      }
      if (item.type === 'transit-stage') {
        realAnchorIdx += 1;
        return [
          {
            id: `stage-${item.transit._id}-${item.variant.tone}-${i}`,
            endAt: item.key,
            legId: item.transit.legId,
            scenarioId,
            activityId: null,
            anchorActivityId: null,
            kind: 'after',
            cascadeActivityIds: downstreamActivityIds(realAnchorIdx + 1),
            ...beforeFieldsAt(realAnchorIdx, item.transit.legId),
          },
        ];
      }
      if (item.type === 'section') {
        return item.activities.map((activity) => {
          realAnchorIdx += 1;
          return {
            id: `activity-${activity._id}`,
            endAt: activityAnchorEndAt(activity, dayStart),
            legId: activity.legId,
            scenarioId,
            activityId: activity._id,
            anchorActivityId: activity._id,
            kind: 'after',
            cascadeActivityIds: downstreamActivityIds(realAnchorIdx + 1),
            ...beforeFieldsAt(realAnchorIdx, activity.legId),
          };
        });
      }
      return []; // scenario-tabs — no single anchor point
    })
    .map((meta, index) => ({ ...meta, index }));
}

// The recalc rule: an Activity dropped after some preceding row starts
// right when that row ends (precedingEndAt) — or, for a `kind: 'day-start'`
// drop, takes over that exact startAt outright — dropped at the very start
// of a container with nothing at all before it, it anchors to the
// container's own day start instead. durationMinutes is never touched
// here: it's independent of position under this model, so it survives a
// drag completely unchanged.
export function resolveDropTiming(
  precedingEndAt: string | null,
  dayStart: string,
): { startAt: string } {
  return { startAt: precedingEndAt ?? dayStart };
}

// An Activity's own end-of-event moment starting from a given `startAt` —
// same duration math as activityAnchorEndAt, just without that function's
// day-start fallback, since every caller here already has a real startAt in
// hand.
function activityEndAt(
  startAt: string,
  activity: Pick<Activity, '_id' | 'durationMinutes' | 'mealType' | 'diningFormat' | 'options'>,
): string {
  const minutes = activityDurationMinutes(activity);
  return minutes == null ? startAt : addMinutesIso(startAt, minutes);
}

// Pushes `cascadeActivityIds` later to clear the space a drop just took
// over — the two `kind`s DragMeta can carry (see its own note above) need
// different shift policies, both applied here rather than as separate
// functions:
//   - `minimal` (an ordinary `kind: 'after'` drop): walks the chain in real
//     chronological order, pushing each one later only as far as
//     `requiredStart` — wherever the previous entry in the chain (starting
//     from the just-dropped Activity's own end) now lands — and stopping the
//     instant one already starts at or after that point, since everything
//     genuinely later than that already has room and was never part of the
//     collision the drop just created.
//   - `uniform` (a `kind: 'day-start'` Check-out drop): every named Activity
//     shifts later by the same fixed `shiftMinutes` (the dropped Activity's
//     own duration) unconditionally, since Check-out taking over the day's
//     first slot pushes the entire rest of the day back by exactly that much
//     — there's no "already has room" case to stop early at.
// A fuzzy (no-startAt) Activity has nothing to shift against/from, so it's
// skipped in either policy without breaking the walk.
function cascadeShift(
  activities: Activity[],
  cascadeActivityIds: string[],
  policy: { kind: 'minimal'; startAfter: string } | { kind: 'uniform'; shiftMinutes: number },
): Activity[] {
  const byId = new Map(activities.map((a) => [a._id, a]));
  const shifted = new Map<string, Activity>();
  if (policy.kind === 'uniform') {
    for (const id of cascadeActivityIds) {
      const a = byId.get(id);
      if (a?.startAt)
        shifted.set(id, { ...a, startAt: addMinutesIso(a.startAt, policy.shiftMinutes) });
    }
  } else {
    let requiredStart = policy.startAfter;
    for (const id of cascadeActivityIds) {
      const a = byId.get(id);
      if (!a?.startAt) continue;
      if (a.startAt >= requiredStart) break;
      shifted.set(id, { ...a, startAt: requiredStart });
      requiredStart = activityEndAt(requiredStart, a);
    }
  }
  return activities.map((a) => shifted.get(a._id) ?? a);
}

// Commits a drop: clones the dragged Activity, rewrites its startAt and
// legId/scenarioId to match `dropMeta`'s position, and clears the
// timeLabel/date fuzzy-timing fields now that a real startAt has taken
// over — mirrors EditContext.handleSave's own "replace by _id" shape so
// this plugs into the same setData(..., ['activities']) commit path. A
// `kind: 'day-start'` drop additionally shifts every Activity named in
// `dropMeta.cascadeActivityIds` later by the dragged Activity's own
// duration (a nominal one minute if it has none), so the Activity that
// used to be first — and everything chronologically after it — moves out
// of the way of the time the dragged Activity just took over.
//
// The dragged Activity's own position in the returned activities array
// also moves — immediately after `dropMeta.anchorActivityId` when it's
// set, or to the end otherwise. Array position is never read for anything
// but day.sequence's own tie-break (see DragMeta's note above), so this is
// what makes an exact-timestamp tie against that anchor resolve correctly
// without rewriting either Activity's own timestamp to fake a gap.
export function applyActivityReorder(
  data: TripData,
  dropMeta: DragMeta,
  activityId: string,
  dayStart: string,
): TripData {
  const activity = data.activities.find((a) => a._id === activityId);
  if (!activity) return data;
  const timing = resolveDropTiming(dropMeta.endAt, dayStart);
  const updated: Activity = {
    ...activity,
    startAt: timing.startAt,
    timeLabel: null,
    date: null,
    legId: dropMeta.legId,
    scenarioId: dropMeta.scenarioId,
  };

  let rest = data.activities.filter((a) => a._id !== activityId);

  if (dropMeta.cascadeActivityIds?.length) {
    rest = cascadeShift(
      rest,
      dropMeta.cascadeActivityIds,
      dropMeta.kind === 'day-start'
        ? { kind: 'uniform', shiftMinutes: activityDurationMinutes(activity) ?? 1 }
        : { kind: 'minimal', startAfter: activityEndAt(timing.startAt, updated) },
    );
  }

  let insertAt = rest.length;
  if (dropMeta.anchorActivityId) {
    const anchorIdx = rest.findIndex((a) => a._id === dropMeta.anchorActivityId);
    if (anchorIdx !== -1) insertAt = anchorIdx + 1;
  }

  return {
    ...data,
    activities: [...rest.slice(0, insertAt), updated, ...rest.slice(insertAt)],
  };
}

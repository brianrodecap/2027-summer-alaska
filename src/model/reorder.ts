// Drag-and-drop reordering for the day list (see DayTimeline.tsx). Three
// kinds of row are drag sources, each with its own rule for what moves and
// what gets reassigned — Stay check-in/out stays a fixed anchor throughout,
// never a drag source itself, since it isn't an independently authored
// entity the way any of the three below are:
//   - An Activity (its own row) carries its own startAt/durationMinutes, so
//     dropping it onto a new position rewrites its startAt (anchored to
//     whatever now sits immediately before it — its durationMinutes is
//     untouched, since duration is independent of position under this
//     model) and its legId/scenarioId (matched to that same position), so a
//     drag across a leg-transition day or into a different scenario tab
//     never leaves a stale legId/scenarioId behind. See
//     applyActivityReorder.
//   - A Transit, dragged via its own Depart row's handle, moves as one
//     compound unit (Depart boundary, every route stage, Arrive boundary)
//     together, since everything but departsAt is derived from it (routed:
//     recomputed fresh by buildTripView's own route walk; unrouted: shifted
//     by the same delta as departsAt, to preserve its own authored
//     arrivesAt's duration) — legId/scenarioId reassign the same way an
//     Activity's do. See applyTransitReorder.
//   - A scenario-group bundle, dragged via the scenario-tabs row's own
//     handle, moves every Activity/Transit under its whole subtree together
//     as one rigid block, each member keeping its own relative offset and
//     its own scenarioId (which branch it's in) — only legId reassigns,
//     since scenarioId encodes which branch a member belongs to, not where
//     the group as a whole sits in the day. See applyBlockReorder.

import {
  activityDurationMinutes,
  activitySortKey,
  addMinutesIso,
  dateOnly,
  diffMinutesIso,
} from './tripModel';
import type { Activity, ScenarioTrack, SequenceItem, Transit, TripData } from './types';

// Names the specific Activity or Transit a DragMeta/RealAnchor entry refers
// to — an Activity's own id is unambiguous on its own, but a Transit's
// Depart boundary, every route stage, and its Arrive boundary all share one
// _id, so `kind` is what tells "insert after this Activity" apart from
// "insert after this Transit" wherever the two could otherwise collide.
type AnchorEntity = { kind: 'activity' | 'transit'; id: string };

// The Activity/Transit ids a scenario-group drag moves together — shared
// with TripSelectionsContextObject.ts's RowSelectionMembers (a multi-select
// can include a scenario-tabs row, whose own members are exactly this
// shape), so that file re-exports this type rather than redefining it.
export interface ReorderMembers {
  activityIds: string[];
  transitIds: string[];
}

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
// stage, an Activity, or a scenario-tabs row) — every row that either
// catches a drop or can itself be dragged. A `scenario-tabs` row is never a
// valid drop *target*: it's a whole nested sub-timeline, not a single point
// in time, so the nearest real row above or below is still what catches a
// drop there. It IS a drag *source*, though — its own DragMeta entry's
// `scenarioGroup` field (below) names every Activity/Transit under its
// whole subtree, moved together as one block by applyBlockReorder.
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
// `anchorEntityId` is what fixes that at the root: when set, it names
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
  // null only for a Stay row with no real anchor to take a time from — a
  // 'Staying' row (always, see stayEventKey), or Check-out/Check-in on a day
  // with no other real top-level content (`first`/`lastAnchor` below both
  // null). applyActivityReorder's resolveDropTiming treats null as "leave
  // the dragged Activity's own time alone" rather than forcing it to this
  // container's literal midnight, which — with nothing else here to make
  // room for or take a slot from — would just be a meaningless, un-asked-for
  // time change.
  endAt: string | null;
  // The container's own day-start (`${date}T00:00`) — always populated,
  // regardless of endAt — so DaysView.tsx's handleDragEnd can resolve which
  // calendar day a drop landed on (needed for resolveDropTiming's own
  // fallback and the cascade shift below) without parsing it out of endAt,
  // which a Stay-row anchor may not have at all.
  containerDayStart: string;
  legId: string;
  scenarioId: string | null;
  activityId: string | null;
  transitId?: string | null;
  scenarioGroup?: ReorderMembers | null;
  anchorEntityId: AnchorEntity | null;
  // 'front-takeover' only ever arrives here via the `{ ...overMeta,
  // ...overMeta.before }` spread in DaysView.tsx's handleDragEnd — a plain
  // DragMeta built by buildDragMeta is always 'after' or 'day-start'.
  kind: 'after' | 'day-start' | 'front-takeover';
  cascadeActivityIds?: string[];
  before?: {
    endAt: string;
    legId: string;
    anchorEntityId: AnchorEntity | null;
    cascadeActivityIds: string[];
    // 'front-takeover' marks the one `before` case with no real preceding
    // anchor at all (see beforeFieldsAt) — applyActivityReorder only honors
    // its forced endAt/cascade when the dragged Activity actually has a
    // real duration to occupy that slot with; a duration-less drag already
    // sorts correctly on its own current startAt (nothing to displace), so
    // forcing a time match there would just be a gratuitous, unrequested
    // time change. 'after' behaves exactly like the plain (non-`before`)
    // case elsewhere in this file.
    kind: 'after' | 'front-takeover';
  };
}

interface RealAnchor {
  endAt: string;
  legId: string;
  entityId: AnchorEntity | null;
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

// Every Activity/Transit id under one scenario-tabs node's own subtree —
// every branch (the tracks passed in), plus any nested child scenario-tabs
// group each track's own sequence folds in (buildScenarioTracks' own
// parentScenarioId nesting, tripModel.ts) — walked recursively so a
// scenario-group drag picks up a nested weather-inside-a-delay split's
// content too, not just the immediate tracks. A Transit's boundary and
// stage rows both name the same transit._id, so transitIds is deduplicated;
// an Activity only ever appears in one track's own sequence, so no
// deduplication is needed there.
function collectScenarioGroupMembers(tracks: ScenarioTrack[]): ReorderMembers {
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

// A scenario-tabs row's own drag/render id — namespaced by calendar day AND
// scenarioId, not just `i` alone, since every DayTimeline instance shares
// one DndContext (DaysView.tsx) and a bare local index collides across
// different days' (or a nested group's own) scenario-tabs rows. Shared by
// this file's own buildDragMeta and DayTimeline.tsx's node-building walk,
// which must produce the exact same id for the same row.
export function scenarioTabsDragId(dayStart: string, scenarioId: string | null, i: number): string {
  return `scenario-tabs-${dateOnly(dayStart)}-${scenarioId ?? 'top'}-${i}`;
}

// `id` mirrors DayTimeline's own node-key scheme exactly (same source
// array, same index) so a rendered row and its DragMeta always share one id
// — that's what lets a dnd-kit sortable id resolve straight back to this.
export function buildDragMeta(
  flattened: SequenceItem[],
  scenarioId: string | null,
  dayStart: string,
  // The day's own legId — used below as the legId for the scenario-tabs
  // DragMeta entry (a whole sub-timeline, not a single row, so it has no
  // real anchor of its own to take a legId from).
  dayLegId: string,
  // A day's top-level { type: 'scenario-tabs' } placeholder (from
  // tripModel.ts's buildSequence) carries no `tracks` of its own — the
  // day's live branch selection lives in `Day.scenarioTracks` instead, the
  // same fallback DayTimeline.tsx's own rendering already uses
  // (`item.tracks ?? day.scenarioTracks`). Only a *nested* scenario-tabs
  // placeholder (from buildTrack) carries its own `tracks`. Without this
  // fallback, dragging a top-level scenario-group bundle collected an empty
  // { activityIds: [], transitIds: [] } and silently moved nothing.
  topLevelScenarioTracks: ScenarioTrack[] = [],
): DragMeta[] {
  const realAnchors = buildRealAnchors(flattened, dayStart);
  const firstActivityIdx = realAnchors.findIndex((a) => a.entityId?.kind === 'activity');
  const lastAnchor = realAnchors[realAnchors.length - 1] ?? null;

  // Every real Activity chronologically after `fromIdx` in `realAnchors` —
  // shared by every `kind: 'after'` anchor below (and by Check-out's own
  // `kind: 'day-start'` cascade, which starts from firstActivityIdx
  // instead), so both cascade rules in applyActivityReorder start from the
  // same downstream list.
  const downstreamActivityIds = (fromIdx: number): string[] =>
    realAnchors
      .slice(fromIdx)
      .map((a) => (a.entityId?.kind === 'activity' ? a.entityId.id : null))
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
        anchorEntityId: preceding?.entityId ?? null,
        cascadeActivityIds: downstreamActivityIds(k),
        kind: preceding ? 'after' : 'front-takeover',
      },
    };
  };

  return flattened
    .flatMap((item, i): Array<Omit<DragMeta, 'index' | 'containerDayStart'>> => {
      if (item.type === 'stay') {
        // Keyed by date, not the per-day flatMap index `i` — a multi-night
        // Stay renders its own row on every night it covers (Check
        // in/Staying/Check out), all sharing one DndContext across the whole
        // day list (DaysView.tsx), so `i` alone collides across days: two
        // different nights can both land at local index 0. The date is the
        // one thing guaranteed unique per Stay row regardless of relation.
        const id = `stay-${item.stay._id}-${dateOnly(dayStart)}`;
        if (item.relation === 'Check out') {
          const first = firstActivityIdx >= 0 ? realAnchors[firstActivityIdx] : null;
          return [
            {
              id,
              endAt: first?.activityStartAt ?? null,
              legId: first?.legId ?? item.stay.legId,
              scenarioId,
              activityId: null,
              anchorEntityId: null,
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
              endAt: lastAnchor?.endAt ?? null,
              legId: lastAnchor?.legId ?? item.stay.legId,
              scenarioId,
              activityId: null,
              anchorEntityId: lastAnchor?.entityId ?? null,
              kind: 'after',
              cascadeActivityIds: [], // Check-in is always last — nothing follows it
            },
          ];
        }
        // A 'Staying' row's own key (item.key) is always dayStart itself
        // (stayEventKey) — synthetic, not a real event time — so, same as
        // Check-out/Check-in with nothing real to anchor to above, endAt is
        // null rather than that literal midnight.
        return [
          {
            id,
            endAt: null,
            legId: item.stay.legId,
            scenarioId,
            activityId: null,
            anchorEntityId: null,
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
            transitId: item.phase === 'depart' ? item.transit._id : null,
            anchorEntityId: null,
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
            anchorEntityId: null,
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
            anchorEntityId: { kind: 'activity', id: activity._id },
            kind: 'after',
            cascadeActivityIds: downstreamActivityIds(realAnchorIdx + 1),
            ...beforeFieldsAt(realAnchorIdx, activity.legId),
          };
        });
      }
      // scenario-tabs — its own drag source (the whole bundle, every branch),
      // never a drop target: see DayTimeline.tsx's droppable: false wiring
      // (Task 7). `before` is intentionally omitted — only relevant for a row
      // that can be dropped onto, which this never is.
      //
      // The id is namespaced by calendar day AND scenarioId, not just `i` —
      // mirrors the Stay-row id fix above exactly, and for the same reason:
      // every DayTimeline instance shares one DndContext (DaysView.tsx), so
      // `i` alone (this scenario-tabs item's own local index within one
      // day's flattened array) collides across different days that both
      // happen to render their first scenario-tabs group at local index 0 —
      // and the date alone isn't enough either, since a nested scenario-tabs
      // group (Task 5's own `walk` recursion) can share a calendar day with
      // its own parent's top-level group.
      return [
        {
          id: scenarioTabsDragId(dayStart, scenarioId, i),
          endAt: item.key,
          legId: dayLegId,
          scenarioId,
          activityId: null,
          anchorEntityId: null,
          kind: 'after' as const,
          scenarioGroup: collectScenarioGroupMembers(item.tracks ?? topLevelScenarioTracks),
        },
      ];
    })
    .map((meta, index) => ({ ...meta, containerDayStart: dayStart, index }));
}

// The recalc rule: an Activity dropped after some preceding row starts right
// when that row ends (precedingEndAt) — or, for a `kind: 'day-start'` drop,
// takes over that exact startAt outright. A null precedingEndAt (see
// DragMeta.endAt's own note) means the drop position had no real anchor to
// take a time from at all — nothing here to make room for or take a slot
// from.
//
// What happens then depends on whether the drop actually crosses onto a
// different calendar day (`crossesDay`, derived by applyActivityReorder
// from the Activity's own current date vs. the destination day, not passed
// down from the container-crossing checks elsewhere in this file — a drop
// that stays within the same container can never cross days, so this stays
// accurate regardless of container). Staying on the same day: the dragged
// Activity just keeps its own current startAt (ownStartAt) instead of being
// forced to some arbitrary time — this is the pre-existing "no real anchor,
// nothing to do" case (dropping onto a mid-stay "Staying" row, or an empty
// same-day scenario's own drop zone). Crossing onto a different day, though,
// has to relocate the Activity onto that day even with no real anchor to
// take over (an entirely empty destination day is exactly this case) — a
// real ownStartAt gets re-based onto the destination's own date, keeping its
// original time-of-day rather than resetting it to midnight; only an
// Activity with no startAt of its own either (a fuzzy timeLabel/date-only
// one) has no time-of-day to carry over, so it falls all the way back to the
// container's own day start, same as it already did for a same-day drop.
// durationMinutes is never touched here: it's independent of position under
// this model, so it survives a drag completely unchanged.
export function resolveDropTiming(
  precedingEndAt: string | null,
  dayStart: string,
  ownStartAt: string | null,
  crossesDay = false,
): { startAt: string } {
  if (precedingEndAt) return { startAt: precedingEndAt };
  if (!crossesDay) return { startAt: ownStartAt ?? dayStart };
  const startAt = ownStartAt ? `${dateOnly(dayStart)}T${ownStartAt.slice(11)}` : dayStart;
  return { startAt };
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
// also moves — immediately after `dropMeta.anchorEntityId` when it names
// an Activity, or to the end otherwise. Array position is never read for anything
// but day.sequence's own tie-break (see DragMeta's note above), so this is
// what makes an exact-timestamp tie against that anchor resolve correctly
// without rewriting either Activity's own timestamp to fake a gap.
export function applyActivityReorder(
  data: TripData,
  dropMeta: DragMeta,
  activityId: string,
  dayStart: string,
  // True specifically for a *same-day* container crossing (a scenario tab
  // <-> the top-level day, or between two scenario tabs on the same date) —
  // DaysView.tsx's handleDragEnd derives this from dnd-kit's own
  // `sortable.containerId` compared against each side's own calendar date,
  // NOT from a bare containerId mismatch. DragMeta's own `index` (and
  // therefore `before`/`movingUp`) is only ever meaningful within one
  // buildDragMeta call, so there's no reliable "genuinely earlier or later"
  // signal to act on once a drag crosses that boundary — only legId/
  // scenarioId (and, for tie-break purposes, array position) should change;
  // the dragged Activity's own time carries over untouched, same as the "no
  // real anchor" case elsewhere in this file. Without this, a same-day
  // cross-container drop still resolves to *some* row's plain DragMeta and
  // forces the dragged Activity onto that row's own instant regardless of
  // duration — this is what the reported Homer-Spit bug actually was.
  //
  // A drop that crosses onto a *different calendar day* must NOT set this:
  // the whole point of that drag is to relocate the Activity onto the new
  // date, and `dropMeta.endAt` (the destination day's own real anchor
  // timestamp, date included) is exactly what accomplishes that — the same
  // "before vs. after" ambiguity that justifies preserving time on a
  // same-day scenario crossing doesn't excuse silently leaving an Activity
  // on its old date when it was dropped onto a different one.
  preserveOwnTiming = false,
): TripData {
  const activity = data.activities.find((a) => a._id === activityId);
  if (!activity) return data;

  // A 'front-takeover' drop (beforeFieldsAt's no-preceding-anchor fallback)
  // only genuinely displaces anything when the dragged Activity has a real
  // duration to occupy the front slot with. A duration-less Activity has
  // nothing to lend, so its own current startAt already sorts correctly on
  // its own merits (see the day-start/checkin-flightseeing precedent this
  // deliberately leaves untouched) — forcing it to the anchor's own instant
  // here would just be an unrequested time change with no real slot taken
  // over, so the drop falls back to "no real anchor" behavior instead: keep
  // the dragged Activity's own time, and don't cascade-shift anyone out of
  // the way of a takeover that never happened.
  const isNoOpFrontTakeover =
    dropMeta.kind === 'front-takeover' && activityDurationMinutes(activity) == null;
  const skipTakeover = preserveOwnTiming || isNoOpFrontTakeover;
  const endAt = skipTakeover ? null : dropMeta.endAt;
  const cascadeActivityIds = skipTakeover ? undefined : dropMeta.cascadeActivityIds;

  // Derived straight from the Activity's own current date, not threaded
  // down from DaysView.tsx's own container-crossing checks — a drop that
  // never leaves its own container can never cross days, so this stays
  // correct regardless of *why* endAt/skipTakeover ended up the way they
  // did (an empty destination day, a duration-less front-takeover, ...).
  // See resolveDropTiming's own note on why this still has to relocate the
  // Activity even with no real anchor to land on.
  const crossesDay = activity.startAt != null && dateOnly(activity.startAt) !== dateOnly(dayStart);
  const timing = resolveDropTiming(endAt, dayStart, activity.startAt, crossesDay);
  const updated: Activity = {
    ...activity,
    startAt: timing.startAt,
    timeLabel: null,
    date: null,
    legId: dropMeta.legId,
    scenarioId: dropMeta.scenarioId,
  };

  let rest = data.activities.filter((a) => a._id !== activityId);

  if (cascadeActivityIds?.length) {
    rest = cascadeShift(
      rest,
      cascadeActivityIds,
      dropMeta.kind === 'day-start'
        ? { kind: 'uniform', shiftMinutes: activityDurationMinutes(activity) ?? 1 }
        : { kind: 'minimal', startAfter: activityEndAt(timing.startAt, updated) },
    );
  }

  const insertAt = reinsertAfterAnchor(rest, dropMeta.anchorEntityId, 'activity');

  return {
    ...data,
    activities: [...rest.slice(0, insertAt), updated, ...rest.slice(insertAt)],
  };
}

// A routed drive (routeId set) never carries its own arrivesAt —
// buildTripView's route walk recomputes it, and every stage time, fresh
// from departsAt on every render, so only departsAt needs to move for it.
// An unrouted Transit's arrivesAt is its own authored field, though —
// shifting departsAt alone would silently collapse or inflate its
// duration, so arrivesAt shifts by the same delta to preserve it exactly.
// Shared by applyTransitReorder (a lone Transit drag) and applyBlockReorder
// (every Transit in a dragged scenario-group bundle).
function shiftedArrivesAt(transit: Transit, deltaMinutes: number): string | null {
  return transit.routeId || !transit.arrivesAt
    ? transit.arrivesAt
    : addMinutesIso(transit.arrivesAt, deltaMinutes);
}

// Repositions a dragged entity within its own array, immediately after
// dropMeta.anchorEntityId when it names another entity of the same `kind` —
// shared by applyActivityReorder (kind: 'activity') and applyTransitReorder
// (kind: 'transit'). See DragMeta's own note on why array position matters:
// it's what makes an exact-timestamp tie against that anchor resolve in the
// dragged entity's favor.
function reinsertAfterAnchor<T extends { _id: string }>(
  rest: T[],
  anchorEntityId: AnchorEntity | null,
  kind: AnchorEntity['kind'],
): number {
  if (anchorEntityId?.kind !== kind) return rest.length;
  const anchorIdx = rest.findIndex((item) => item._id === anchorEntityId.id);
  return anchorIdx === -1 ? rest.length : anchorIdx + 1;
}

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
  const crossesDay = dateOnly(transit.departsAt) !== dateOnly(dayStart);
  const timing = resolveDropTiming(endAt, dayStart, transit.departsAt, crossesDay);
  const deltaMinutes = diffMinutesIso(transit.departsAt, timing.startAt);

  const updated: Transit = {
    ...transit,
    departsAt: timing.startAt,
    arrivesAt: shiftedArrivesAt(transit, deltaMinutes),
    legId: dropMeta.legId,
    scenarioId: dropMeta.scenarioId,
  };

  const rest = data.transits.filter((t) => t._id !== transitId);
  const insertAt = reinsertAfterAnchor(rest, dropMeta.anchorEntityId, 'transit');

  return {
    ...data,
    transits: [...rest.slice(0, insertAt), updated, ...rest.slice(insertAt)],
  };
}

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
  members: ReorderMembers,
  dayStart: string,
): TripData {
  const activityIds = new Set(members.activityIds);
  const transitIds = new Set(members.transitIds);

  // A block with zero Transits and every Activity fuzzy (no startAt) has no
  // real time to anchor a shift from — anchorTime falls back to null (a
  // correct timing no-op below) rather than early-returning `data`
  // unchanged, so legId still reassigns to every member below even in that
  // edge case (the plan's own "legId reassigns unconditionally" requirement).
  let anchorTime: string | null = null;
  for (const a of data.activities) {
    if (activityIds.has(a._id) && a.startAt && (anchorTime === null || a.startAt < anchorTime)) {
      anchorTime = a.startAt;
    }
  }
  for (const t of data.transits) {
    if (transitIds.has(t._id) && (anchorTime === null || t.departsAt < anchorTime)) {
      anchorTime = t.departsAt;
    }
  }
  const crossesDay = anchorTime !== null && dateOnly(anchorTime) !== dateOnly(dayStart);
  const timing = anchorTime
    ? resolveDropTiming(dropMeta.endAt, dayStart, anchorTime, crossesDay)
    : null;
  const deltaMinutes = timing && anchorTime ? diffMinutesIso(anchorTime, timing.startAt) : 0;

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
        arrivesAt: shiftedArrivesAt(t, deltaMinutes),
        legId: dropMeta.legId,
      };
    }),
  };
}

// Moves an entire multi-selected group of Activities together, as one
// contiguous back-to-back block landing at dropMeta's position and keeping
// the group's own original relative chronological order — DaysView.tsx's
// handleDragEnd calls this instead of applyActivityReorder when the dragged
// row was part of a DayTimeline.tsx drag-handle multi-select made up
// entirely of plain Activity rows (a selection that also includes a Transit
// row or a scenario-group bundle instead moves via applyBlockReorder — see
// handleDragEnd's own note on why). The selection itself can span more than
// one rendered Timeline, including across different calendar days (a
// multi-day selection — see RowSelection in TripSelectionsContextObject.ts,
// which tracks each selected row's own origin container rather than
// confining a selection to one container), so unlike a single-Activity drop
// this can't take one shared preserveOwnTiming flag for the whole group:
// `shouldPreserveOwnTiming` is
// asked per Activity, since a member being relocated onto a different
// calendar day than it started on must take over the destination's own
// anchor timestamp (see applyActivityReorder's own note on why that flag
// only ever applies to a same-day container crossing), while a member
// whose origin was already on the same day as the drop — just a different
// scenario container — keeps its own time untouched, same as a lone
// same-day cross-container drop would.
//
// Implemented by chaining applyActivityReorder once per Activity in
// `orderedActivityIds` rather than re-deriving its timing/cascade rules
// independently: the first call lands exactly like an ordinary
// single-Activity drop at `dropMeta`. Each following call re-anchors
// dropMeta to sit immediately after whichever Activity the previous
// iteration just placed — same `endAt`-from-precedingEndAt contract every
// other drop already uses — so the whole group ends up back-to-back in the
// order it started in. `anchorEntityId` always advances to the
// just-placed Activity even when it has no real startAt to lend (a fuzzy
// timeLabel-only Activity): that keeps every later group member inserting
// after it in the activities array, not before it, without forcing a
// timing change nothing asked for. Already-placed group members are
// stripped from later cascadeActivityIds lists, since a group member is
// never "in the way" of itself the way a genuine bystander Activity is.
export function applyGroupActivityReorder(
  data: TripData,
  dropMeta: DragMeta,
  orderedActivityIds: string[],
  dayStart: string,
  shouldPreserveOwnTiming: (activityId: string) => boolean,
): TripData {
  const isGroupMember = new Set(orderedActivityIds);
  let result = data;
  let nextDropMeta = dropMeta;
  for (const activityId of orderedActivityIds) {
    result = applyActivityReorder(
      result,
      nextDropMeta,
      activityId,
      dayStart,
      shouldPreserveOwnTiming(activityId),
    );
    const placed = result.activities.find((a) => a._id === activityId);
    if (!placed) continue;
    nextDropMeta = {
      ...nextDropMeta,
      endAt: placed.startAt ? activityEndAt(placed.startAt, placed) : nextDropMeta.endAt,
      anchorEntityId: { kind: 'activity', id: placed._id },
      kind: 'after',
      cascadeActivityIds: nextDropMeta.cascadeActivityIds?.filter((id) => !isGroupMember.has(id)),
    };
  }
  return result;
}

// layoutDay: one calendar day's display rows, sliced out of the trip-wide
// timeline. A day is a DISPLAY concern here — everything about what happened
// and when is already decided by buildTimeline; this turns that day's events
// into rows (one per event), adds the stay in progress, and boxes each
// scenario group's active branch under one tab strip.
//
// Only two rows are not events: the stay you are in the middle of (a StayRow
// with no event) and a scenario box (BoxRow). A scenario group's INACTIVE
// members are still listed as tabs — they are the strip's chips — but carry no
// rows, because their events aren't in the timeline.
import type { ScenarioGroup } from './scenarioGroups';
import type { TimelineEvent } from './timeline';
import { earliestKey, stayEventKey, stayRelation } from './tripModel';
import type {
  DayRow,
  EnrichedActivity,
  EnrichedStay,
  EnrichedTransit,
  Note,
  Scenario,
  ScenarioTrack,
} from './types';

export interface DayLayoutInput {
  date: string;
  events: TimelineEvent[]; // the timeline's events on `date` (indexTimeline's byDate)
  groups: ScenarioGroup[]; // scenarioGroups(...) — eligible groups only
  stays: EnrichedStay[]; // the stays overlapping this date (Day.stays)
  activities: ReadonlyMap<string, EnrichedActivity>;
  transits: ReadonlyMap<string, EnrichedTransit>;
  notesForScenario: (scenario: Scenario) => Note[];
  // The ids a scenario owns on this date, active or not (see
  // ScenarioTrack.members) — an inactive scenario's events aren't in the
  // timeline, so the caller derives them from the data.
  membersOfScenario: (scenarioId: string) => ScenarioTrack['members'];
}

export interface DayLayout {
  rows: DayRow[];
  scenarioTracks: ScenarioTrack[]; // the day's top-level tabs, flat
}

// Rows in clock order; a same-instant tie keeps insertion order (stays, then
// events in timeline order — which already breaks an Activity tie, then boxes).
const byKey = (a: DayRow, b: DayRow) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

export function layoutDay(input: DayLayoutInput): DayLayout {
  const { date, events, groups, stays, activities, transits } = input;
  const dayStart = `${date}T00:00`;
  const eventById = new Map(events.map((e) => [e.id, e]));

  // The rows that belong to one scope: the unscoped backbone (null), or one
  // scenario's own content.
  function scopedRows(scope: string | null): DayRow[] {
    const rows: DayRow[] = [];
    for (const stay of stays) {
      if ((stay.scenarioId ?? null) !== scope) continue;
      const relation = stayRelation(stay, date);
      // A stay in progress has no boundary today; an Overnight one (in and out
      // the same day) is one row, at its check-in.
      const event =
        relation === 'Staying'
          ? null
          : (eventById.get(`${relation === 'Check out' ? 'check-out' : 'check-in'}:${stay._id}`) ??
            null);
      rows.push({
        type: 'stay',
        event,
        stay,
        relation,
        key: stayEventKey(stay, relation, dayStart),
      });
    }
    for (const event of events) {
      if ((event.scenarioId ?? null) !== scope) continue;
      if (event.source.kind === 'transit') {
        const transit = transits.get(event.source.id) as EnrichedTransit;
        if (event.kind === 'route-stage') {
          if (event.stage && event.stageIndex !== undefined) {
            rows.push({
              type: 'transit',
              event,
              transit,
              phase: 'stage',
              stage: event.stage,
              stageIndex: event.stageIndex,
              key: event.at,
            });
          }
        } else {
          const phase = event.kind === 'depart' ? 'depart' : 'arrive';
          rows.push({ type: 'transit', event, transit, phase, key: event.at });
        }
      } else if (event.kind === 'activity') {
        const activity = activities.get(event.source.id) as EnrichedActivity;
        rows.push({ type: 'activity', event, activity, key: event.at });
      }
    }
    return rows;
  }

  const presentGroups = groups.filter((g) => g.anchorAtByDate[date] !== undefined);

  // One group's tabs on this date — every member with content here, with only
  // the ACTIVE member's rows filled in. A member's own nested groups
  // (parentScenarioId) are folded into its rows as their own box, keyed at that
  // group's anchor exactly as the outer one is.
  function tracksOf(group: ScenarioGroup): ScenarioTrack[] {
    return (group.membersByDate[date] ?? []).map((id): ScenarioTrack => {
      const scenario = group.scenarios.find((s) => s._id === id) as Scenario;
      const active = id === group.activeId;
      return {
        scenario,
        notes: input.notesForScenario(scenario),
        rows: active ? rowsOf(id) : [],
        groupKey: group.key,
        active,
        members: input.membersOfScenario(id),
      };
    });
  }

  function rowsOf(scenarioId: string): DayRow[] {
    const rows = scopedRows(scenarioId);
    for (const group of presentGroups.filter((g) => g.parentId === scenarioId)) {
      const tracks = tracksOf(group);
      // A box with no active tab (the picked member has nothing on this date)
      // renders nothing, so it gets no row to leave a dangling connector.
      if (tracks.some((t) => t.active)) {
        rows.push({ type: 'box', key: group.anchorAtByDate[date], tracks });
      }
    }
    return rows.sort(byKey);
  }

  const topLevel = presentGroups.filter((g) => g.parentId === null);
  const scenarioTracks = topLevel.flatMap(tracksOf);
  const rows = scopedRows(null);
  // One box for the whole day's tab strip, at the earliest of its groups'
  // anchors (the strip lists every top-level group's tabs together).
  const anchor = earliestKey(topLevel.map((g) => g.anchorAtByDate[date]));
  if (anchor && scenarioTracks.some((t) => t.active)) {
    rows.push({ type: 'box', key: anchor, tracks: scenarioTracks });
  }

  return { rows: rows.sort(byKey), scenarioTracks };
}

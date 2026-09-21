// The trip page's filter nav: lets a reader narrow the day list down to just
// what's Booked, still needs booking, tagged a highlight, flagged with a
// warning note, or belongs to one leg. A direct port of docs/js/filters.js's
// group vocabulary and AND-across/OR-within matching rule, adapted to filter
// real Day/DayRow data (via filterTagsFor, tripModel.ts) instead of
// toggling CSS classes on rendered DOM nodes — the React tree here can just
// not render a filtered-out row in the first place.
import { filterTagsFor } from './tripModel';
import type {
  Day,
  DayRow,
  EnrichedActivity,
  EnrichedTransit,
  LegSummary,
  ScenarioTrack,
} from './types';

export interface FilterOption {
  token: string;
  label: string;
  icon: string;
}

export interface FilterGroup {
  id: string;
  label: string;
  options: FilterOption[];
}

const GROUP_DEFS: FilterGroup[] = [
  {
    id: 'booking',
    label: 'Booking',
    options: [
      { token: 'booking:booked', label: 'Booked', icon: 'check_circle' },
      { token: 'booking:needs', label: 'Needs booking', icon: 'schedule' },
    ],
  },
  {
    id: 'attr',
    label: 'Attributes',
    options: [
      { token: 'attr:highlight', label: 'Highlights', icon: 'star' },
      { token: 'attr:attention', label: 'Needs attention', icon: 'warning' },
    ],
  },
];

// The Leg group is the only one built from live trip data rather than a
// fixed vocabulary — one option per Leg, in the trip's own leg order.
export function buildFilterGroups(legSummaries: LegSummary[]): FilterGroup[] {
  const legOptions = legSummaries.map((s) => ({
    token: `leg:${s.leg._id}`,
    label: s.leg.name,
    icon: 'route',
  }));
  return [...GROUP_DEFS, { id: 'leg', label: 'Leg', options: legOptions }];
}

// A row matches when every *represented* group has at least one of its
// tokens active (AND across groups — booking vs. leg are independent
// questions), but any one of a group's own active tokens is enough (OR
// within a group). A group nobody has touched yet imposes no constraint at
// all; no active filters at all always matches everything.
export function rowMatches(tags: string[], activeTokens: Set<string>): boolean {
  if (!activeTokens.size) return true;
  const tagSet = new Set(tags);
  const activeByGroup = new Map<string, string[]>();
  for (const token of activeTokens) {
    const group = token.split(':')[0];
    if (!activeByGroup.has(group)) activeByGroup.set(group, []);
    activeByGroup.get(group)!.push(token);
  }
  for (const groupTokens of activeByGroup.values()) {
    if (!groupTokens.some((t) => tagSet.has(t))) return false;
  }
  return true;
}

// Narrows a day's rows to the ones that still match every active filter. One
// row per event, each tagged from its own entity; a scenario box passes
// through unfiltered (its tabs are choices, not content).
export function filterRows(rows: DayRow[], activeTokens: Set<string>): DayRow[] {
  if (!activeTokens.size) return rows;
  return rows.filter((row) => {
    switch (row.type) {
      case 'stay':
        return rowMatches(filterTagsFor(row.stay), activeTokens);
      case 'transit':
        return rowMatches(filterTagsFor(row.transit), activeTokens);
      case 'activity':
        return rowMatches(filterTagsFor(row.activity), activeTokens);
      case 'box':
        return true;
    }
  });
}

// The entities an inactive scenario branch owns, looked up by id — its rows
// aren't laid out (its events aren't in the timeline), only its member ids are.
export interface EntityLookup {
  activities: ReadonlyMap<string, EnrichedActivity>;
  transits: ReadonlyMap<string, EnrichedTransit>;
}

function trackHasVisibleContent(
  track: ScenarioTrack,
  day: Pick<Day, 'stays'>,
  activeTokens: Set<string>,
  lookup: EntityLookup,
): boolean {
  if (track.active) return rowsHaveVisibleContent(track.rows, day, activeTokens, lookup);
  // An alternate the reader hasn't selected still counts: a day whose only
  // match is behind another tab must stay in the list so the reader can switch
  // to it.
  const { activityIds, transitIds, stayIds } = track.members;
  const matches = (entity: Parameters<typeof filterTagsFor>[0] | undefined) =>
    entity !== undefined && rowMatches(filterTagsFor(entity), activeTokens);
  return (
    activityIds.some((id) => matches(lookup.activities.get(id))) ||
    transitIds.some((id) => matches(lookup.transits.get(id))) ||
    stayIds.some((id) => matches(day.stays.find((s) => s._id === id)))
  );
}

function rowsHaveVisibleContent(
  rows: DayRow[],
  day: Pick<Day, 'stays'>,
  activeTokens: Set<string>,
  lookup: EntityLookup,
): boolean {
  return rows.some((row) => {
    switch (row.type) {
      case 'stay':
        return rowMatches(filterTagsFor(row.stay), activeTokens);
      case 'transit':
        // A route stage never makes a day visible on its own — its Transit's
        // Depart/Arrive rows carry the same tags.
        return row.phase !== 'stage' && rowMatches(filterTagsFor(row.transit), activeTokens);
      case 'activity':
        return rowMatches(filterTagsFor(row.activity), activeTokens);
      case 'box':
        return row.tracks.some((t) => trackHasVisibleContent(t, day, activeTokens, lookup));
    }
  });
}

// Whether a whole day-block has anything left to show once the active
// filters are applied — a day-block with zero surviving rows hides entirely
// rather than rendering an empty shell (docs/js/filters.js's own
// applyFilters did the same via .filtered-out on the whole .day-block).
// Scenario tabs the reader isn't on are searched too (via `lookup`), so a match
// that lives only in another branch keeps its day visible.
export function dayHasVisibleContent(
  day: Day,
  activeTokens: Set<string>,
  lookup: EntityLookup,
): boolean {
  if (!activeTokens.size) return true;
  return rowsHaveVisibleContent(day.rows, day, activeTokens, lookup);
}

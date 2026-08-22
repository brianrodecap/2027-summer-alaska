// The trip page's filter nav: lets a reader narrow the day list down to just
// what's Booked, still needs booking, tagged a highlight, flagged with a
// warning note, or belongs to one leg. A direct port of docs/js/filters.js's
// group vocabulary and AND-across/OR-within matching rule, adapted to filter
// real Day/SequenceItem data (via filterTagsFor, tripModel.ts) instead of
// toggling CSS classes on rendered DOM nodes — the React tree here can just
// not render a filtered-out row in the first place.
import { filterTagsFor } from './tripModel';
import type { Day, LegSummary, SequenceItem } from './types';

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

// Filters one day's (or one scenario track's) own sequence down to the items
// that still match — a Stay/Transit's tags come from the whole entity (its
// depart/arrive/stage items always show or hide together), a section keeps
// only its still-matching activities and drops out entirely once none are
// left. A scenario-tabs item is always kept as-is: it recurses into its own
// nested DayTimeline render, which re-applies this same filter to that
// track's own sequence.
export function filterSequenceItems(
  sequence: SequenceItem[],
  activeTokens: Set<string>,
): SequenceItem[] {
  if (!activeTokens.size) return sequence;
  const result: SequenceItem[] = [];
  for (const item of sequence) {
    if (item.type === 'stay') {
      if (rowMatches(filterTagsFor(item.stay), activeTokens)) result.push(item);
      continue;
    }
    if (item.type === 'transit-boundary' || item.type === 'transit-stage') {
      if (rowMatches(filterTagsFor(item.transit), activeTokens)) result.push(item);
      continue;
    }
    if (item.type === 'section') {
      const activities = item.activities.filter((a) => rowMatches(filterTagsFor(a), activeTokens));
      if (activities.length) result.push({ ...item, activities });
      continue;
    }
    result.push(item); // scenario-tabs
  }
  return result;
}

function sequenceHasVisibleContent(
  sequence: SequenceItem[],
  day: Day,
  activeTokens: Set<string>,
): boolean {
  for (const item of sequence) {
    if (item.type === 'stay' && rowMatches(filterTagsFor(item.stay), activeTokens)) return true;
    if (item.type === 'transit-boundary' && rowMatches(filterTagsFor(item.transit), activeTokens))
      return true;
    if (
      item.type === 'section' &&
      item.activities.some((a) => rowMatches(filterTagsFor(a), activeTokens))
    )
      return true;
    if (item.type === 'scenario-tabs') {
      const tracks = item.tracks ?? day.scenarioTracks;
      if (tracks.some((t) => sequenceHasVisibleContent(t.sequence, day, activeTokens))) return true;
    }
  }
  return false;
}

// Whether a whole day-block has anything left to show once the active
// filters are applied — a day-block with zero surviving rows hides entirely
// rather than rendering an empty shell (docs/js/filters.js's own
// applyFilters did the same via .filtered-out on the whole .day-block).
export function dayHasVisibleContent(day: Day, activeTokens: Set<string>): boolean {
  if (!activeTokens.size) return true;
  return sequenceHasVisibleContent(day.sequence, day, activeTokens);
}

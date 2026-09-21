// A meal Activity with several still-open MealOption candidates (see
// docs-model.html's Activity entity) needs to know which candidates are
// still actually choosable today, and what to call whichever one's selected
// — logic shared by the meal row and the activity detail panel, so it lives
// here rather than inside either's own component file.
import { DINING_FORMAT_LABEL } from './formatting';
import { activitiesDeep, activityTimeLabel, overlapWarningsFor, stayRelation } from './tripModel';
import type {
  Activity,
  Day,
  DiningFormat,
  EnrichedActivity,
  EnrichedMealOption,
  MealOption,
  Place,
  Ref,
  Stay,
} from './types';

type StayForOption = Pick<Stay, '_id' | 'packages' | 'checkInAt' | 'checkOutAt'>;

// Which Stay a MealOption's includedIn ref is actually about — a plain
// { entity: 'stay' } ref for 'included', or a { entity: 'package' } ref for
// 'package', which requires looking inside each stay's own packages[] to
// find the one that owns that package id.
function stayForIncludedIn<S extends StayForOption>(stays: S[], includedIn: Ref | null): S | null {
  if (!includedIn || !('entity' in includedIn)) return null;
  if (includedIn.entity === 'stay') return stays.find((s) => s._id === includedIn.id) ?? null;
  if (includedIn.entity === 'package') {
    return stays.find((s) => s.packages?.some((p) => p._id === includedIn.id)) ?? null;
  }
  return null;
}

// An 'included' or 'package' candidate only actually reads as covered once its
// stay is underway — this same day, before check-in has happened, there's no
// room to have gotten breakfast bundled (or package-covered) into yet. Any
// other diningFormat has no such precondition. `stays` is whichever Stays
// overlap `date` (a Day's own stays, or the timeline's date-filtered set).
function isIncludedOptionActive(
  stays: StayForOption[],
  date: string,
  option: Pick<MealOption, 'diningFormat' | 'includedIn'>,
): boolean {
  if (option.diningFormat !== 'included' && option.diningFormat !== 'package') return true;
  const stay = stayForIncludedIn(stays, option.includedIn);
  return !!stay && stayRelation(stay, date) !== 'Check in';
}

// activity.options is only ever set while a meal is genuinely undecided
// among named candidates — that's also what distinguishes a meal Activity
// from a plain one everywhere the day list, its map panel, and its live
// dining-format overrides need to branch on it.
export function isMealActivity(activity: { options: unknown[] | null }): boolean {
  return Boolean(activity.options?.length);
}

export function activeMealOptions(
  activity: { options: EnrichedMealOption[] | null },
  day: Day,
): EnrichedMealOption[] {
  return activeMealOptionsOn(activity.options ?? [], day.stays, day.date);
}

// The same filter for a caller with no Day — the timeline builder, which only
// has the trip's Stays and an event's own date.
export function activeMealOptionsOn<O extends Pick<MealOption, 'diningFormat' | 'includedIn'>>(
  options: O[],
  stays: StayForOption[],
  date: string,
): O[] {
  return options.filter((option) => isIncludedOptionActive(stays, date, option));
}

export function mealOptionLabel(option: EnrichedMealOption): string {
  return option.place ? option.place.label : DINING_FORMAT_LABEL[option.diningFormat];
}

// Which of a still-open meal's active candidates is currently selected —
// shared by every reader that needs the candidate itself rather than just
// its index (resolveActivityPlace below, ActivityNode's note-menu targeting,
// liveFormatOverrides' per-activity dining-format lookup).
export function selectedMealOption(
  options: EnrichedMealOption[],
  mealOptionIndex: Map<string, number>,
  activityId: string,
): EnrichedMealOption | undefined {
  return options[selectedMealOptionIndex(options, mealOptionIndex, activityId)];
}

// The Place a row on the day timeline actually names for travel-distance
// purposes — a plain Activity's own place, or, for a still-open meal, whichever
// candidate is currently selected, since a meal's real-world location isn't
// decided until one candidate wins. The timeline builder resolves every
// activity event's place through this (TimelineEvent.place), so the map, route
// URLs, travel totals and the row footers all read the same answer.
export function resolveActivityPlace(
  activity: Pick<Activity, '_id' | 'place'> & { options: MealOption[] | null },
  stays: StayForOption[],
  date: string,
  mealOptionIndex: ReadonlyMap<string, number>,
): Place | null {
  if (!isMealActivity(activity)) return activity.place;
  const options = activeMealOptionsOn(activity.options ?? [], stays, date);
  return options[selectedMealOptionIndex(options, mealOptionIndex, activity._id)]?.place ?? null;
}

// A still-open meal has no durationMinutes of its own to show an end time
// for — activityDurationMinutes' diningFormat-shaped estimate (see
// tripModel.ts) is the only thing that can stand in, and it varies by which
// candidate is currently selected (a sit-down lunch runs longer than a
// grab-and-go one), so this recomputes per-candidate via formatOverrides
// rather than reading the Activity's own stored estimate.
export function mealOptionTimeLabel(
  activity: Pick<
    Activity,
    '_id' | 'startAt' | 'timeLabel' | 'durationMinutes' | 'mealType' | 'diningFormat' | 'options'
  >,
  option: EnrichedMealOption,
): string {
  return activityTimeLabel(activity, new Map([[activity._id, option.diningFormat]]));
}

// The stored per-activity index (TripSelectionsContext's mealOptionIndex map)
// clamps back to 0 once a candidate it pointed at drops out of
// activeMealOptions (e.g. an 'included' candidate that just went active
// itself and displaced it) — shared by the meal row and the day-list note
// menu, so both agree on which candidate "selected" means right now.
export function selectedMealOptionIndex(
  options: unknown[],
  mealOptionIndex: ReadonlyMap<string, number>,
  activityId: string,
): number {
  const stored = mealOptionIndex.get(activityId);
  return stored !== undefined && stored < options.length ? stored : 0;
}

// Every Activity the day actually renders, top-level plus every scenario
// track's own branch (recursing into nested scenario-tabs splits, e.g. Jul
// 1's "if it flew today"/"if grounded today" pair nested under its alt
// track) — the pool overlapWarningsFor below checks a meal against, same
// scope the day's own timeline draws from. Cached per Day object (stable
// for the life of one buildTripView result) since every row on the day
// calls this once per render.
const dayActivitiesCache = new WeakMap<Day, EnrichedActivity[]>();

function dayActivities(day: Day): EnrichedActivity[] {
  const cached = dayActivitiesCache.get(day);
  if (cached) return cached;
  const byId = new Map<string, EnrichedActivity>();
  for (const activity of activitiesDeep(day.rows)) byId.set(activity._id, activity);
  const result = [...byId.values()];
  dayActivitiesCache.set(day, result);
  return result;
}

// Every still-open meal in the day, keyed to whichever candidate its own
// chip row currently has selected — the live counterpart to each Activity's
// own diningFormat/first-candidate default that overlapWarningsFor falls
// back to at page load. Every row on the day calls this once per render
// (via liveOverlapWarnings below), so it's cached per (day, mealOptionIndex)
// the same way dayActivities is — without it, a day with M activities would
// redo this whole M-activity scan for each of its M rows.
const liveFormatOverridesCache = new WeakMap<
  Day,
  { mealOptionIndex: Map<string, number>; overrides: Map<string, DiningFormat> }
>();

function liveFormatOverrides(
  day: Day,
  mealOptionIndex: Map<string, number>,
): Map<string, DiningFormat> {
  const cached = liveFormatOverridesCache.get(day);
  if (cached && cached.mealOptionIndex === mealOptionIndex) return cached.overrides;
  const overrides = new Map<string, DiningFormat>();
  for (const activity of dayActivities(day)) {
    if (!isMealActivity(activity)) continue;
    const options = activeMealOptions(activity, day);
    const selected = selectedMealOption(options, mealOptionIndex, activity._id);
    if (selected) overrides.set(activity._id, selected.diningFormat);
  }
  liveFormatOverridesCache.set(day, { mealOptionIndex, overrides });
  return overrides;
}

// A still-open meal's overlap warnings (see tripModel.ts's overlapWarningsFor)
// were computed once at page load against its first candidate's format —
// switching to a different candidate (e.g. a quick self-catered breakfast in
// place of a sit-down package one) can genuinely clear or introduce an
// overlap, so the meal row recomputes live against whatever's actually
// selected right now, rather than showing a stale build-time verdict.
export function liveOverlapWarnings(
  activity: EnrichedActivity,
  day: Day,
  mealOptionIndex: Map<string, number>,
): { transitOverlapWarning: string | null; activityOverlapWarning: string | null } {
  return overlapWarningsFor(
    activity,
    dayActivities(day),
    day.transits,
    liveFormatOverrides(day, mealOptionIndex),
  );
}

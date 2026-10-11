// A meal Activity with several still-open MealOption candidates (see
// docs-model.html's Activity entity) needs to know which candidates are
// still actually choosable today, and what to call whichever one's selected
// — logic shared by the meal row and the activity detail panel, so it lives
// here rather than inside either's own component file.
import { DINING_FORMAT_LABEL } from './formatting';
import {
  activitiesDeep,
  activityTimeLabel,
  activityTimelineKey,
  activityWarnings,
  dateOnly,
  resolveActivityDate,
  stayRelation,
  staysInScope,
} from './tripModel';
import type {
  Activity,
  Day,
  EnrichedActivity,
  EnrichedMealOption,
  MealOption,
  Package,
  Ref,
  Stay,
  Transit,
} from './types';

type StayForOption = Pick<Stay, '_id' | 'packages' | 'checkInAt' | 'checkOutAt'>;

// A Transit or Activity that may hold Packages (see packages.ts), with when it
// starts: all a meal needs is whether a package ref names one of its packages
// and whether the holder has begun.
export interface PackageCarrier {
  packages?: Package[] | null;
  startsAt: string;
}

// The Transits under way on `date` (departed that day or earlier, not yet
// arrived by its end; a routed one has no authored arrival, so only its
// departure day) and Activities falling on it — the one rule both
// the day's rows and the timeline builder use, so they can't disagree about
// which meal candidates a package covers.
export function packageCarriersOn(
  transits: Pick<Transit, 'departsAt' | 'arrivesAt' | 'packages'>[],
  activities: Pick<Activity, 'startAt' | 'date' | 'packages'>[],
  date: string,
): PackageCarrier[] {
  return [
    ...transits
      .filter((t) => dateOnly(t.departsAt) <= date && date <= dateOnly(t.arrivesAt ?? t.departsAt))
      .map((t) => ({ packages: t.packages, startsAt: t.departsAt })),
    ...activities
      .filter((a) => resolveActivityDate(a as Activity) === date)
      .map((a) => ({ packages: a.packages, startsAt: a.startAt ?? `${date}T00:00` })),
  ];
}

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

// A 'package' candidate held by a Transit or Activity (a tour's included lunch)
// has no stay to wait for: it reads as covered from the holder's own start on
// its own date, so `carriers` are those on the meal's date (packageCarriersOn).
function carriesPackage(carriers: PackageCarrier[], includedIn: Ref | null, at: string): boolean {
  if (!includedIn || !('entity' in includedIn) || includedIn.entity !== 'package') return false;
  return carriers.some((c) => c.startsAt <= at && c.packages?.some((p) => p._id === includedIn.id));
}

// An 'included' or 'package' candidate only actually reads as covered once its
// stay is underway — before check-in has happened there's no room to have
// gotten breakfast bundled (or package-covered) into yet. On the check-in day
// that's decided by the meal's own time (`at`, its timeline instant), not the
// whole date: a first-night dinner onboard after a 3pm embarkation is covered.
// Any other diningFormat has no such precondition. `stays` is whichever Stays
// overlap `date` (a Day's own stays, or the timeline's date-filtered set).
function isIncludedOptionActive(
  stays: StayForOption[],
  carriers: PackageCarrier[],
  date: string,
  at: string,
  option: Pick<MealOption, 'diningFormat' | 'includedIn'>,
): boolean {
  if (option.diningFormat !== 'included' && option.diningFormat !== 'package') return true;
  const stay = stayForIncludedIn(stays, option.includedIn);
  if (!stay) return carriesPackage(carriers, option.includedIn, at);
  return stayRelation(stay, date) !== 'Check in' || at >= stay.checkInAt;
}

// activity.options is only ever set while a meal is genuinely undecided
// among named candidates — that's also what distinguishes a meal Activity
// from a plain one everywhere the day list, its map panel, and its live
// dining-format overrides need to branch on it.
export function isMealActivity(activity: { options: unknown[] | null }): boolean {
  return Boolean(activity.options?.length);
}

export function activeMealOptions(activity: EnrichedActivity, day: Day): EnrichedMealOption[] {
  const at = activityTimelineKey(activity)?.at ?? `${day.date}T00:00`;
  return activeMealOptionsOn(activity.options ?? [], day.stays, day.mealCarriers, day.date, at);
}

// The same filter for a caller with no Day — the timeline builder, which only
// has the trip's Stays and an event's own date.
export function activeMealOptionsOn<O extends Pick<MealOption, 'diningFormat' | 'includedIn'>>(
  options: O[],
  stays: StayForOption[],
  carriers: PackageCarrier[],
  date: string,
  at: string,
): O[] {
  return options.filter((option) => isIncludedOptionActive(stays, carriers, date, at, option));
}

export function mealOptionLabel(option: EnrichedMealOption): string {
  return option.place ? option.place.label : DINING_FORMAT_LABEL[option.diningFormat];
}

// Which of a still-open meal's active candidates is currently selected —
// shared by every reader that needs the candidate itself rather than just
// its index (selectedMealOptionOn below, ActivityNode's note-menu targeting,
// selectedMealOptions' per-activity lookup).
export function selectedMealOption<O>(
  options: O[],
  mealOptionIndex: ReadonlyMap<string, number>,
  activityId: string,
): O | undefined {
  return options[selectedMealOptionIndex(options, mealOptionIndex, activityId)];
}

// The same selection for a caller with no Day (the timeline builder, via
// selectedMealOptions below): filter a meal's candidates down to the active
// ones on `date`/`at`, then take whichever one is currently selected.
export function selectedMealOptionOn(
  activity: Pick<Activity, '_id'> & { options: MealOption[] | null },
  stays: StayForOption[],
  carriers: PackageCarrier[],
  date: string,
  at: string,
  mealOptionIndex: ReadonlyMap<string, number>,
): MealOption | undefined {
  const options = activeMealOptionsOn(activity.options ?? [], stays, carriers, date, at);
  return selectedMealOption(options, mealOptionIndex, activity._id);
}

// A still-open meal has no durationMinutes of its own to show an end time
// for — activityDurationMinutes' diningFormat-shaped estimate (see
// tripModel.ts) is the only thing that can stand in, and it varies by which
// candidate is currently selected (a sit-down lunch runs longer than a
// grab-and-go one), so this recomputes per-candidate via selectedMeals
// rather than reading the Activity's own stored estimate.
export function mealOptionTimeLabel(
  activity: Pick<
    Activity,
    '_id' | 'startAt' | 'timeLabel' | 'durationMinutes' | 'mealType' | 'diningFormat' | 'options'
  >,
  option: EnrichedMealOption,
): string {
  return activityTimeLabel(activity, new Map([[activity._id, option]]));
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

// Every still-open meal's currently selected candidate, keyed by activity id
// — the one shared answer to "which candidate is live right now". Built once
// per selection by the timeline builder (so a lunch stop folded into a drive
// runs as long as the meal actually picked) and handed on to each live Day as
// day.selectedMeals, which the rows' overlap and port-call warnings below
// read — so the two can never disagree about the same meal. An activity with
// no timeline key of its own isn't on the timeline, so it's skipped.
export function selectedMealOptions(
  activities: Iterable<Activity>,
  staysOn: (date: string) => StayForOption[],
  carriersOn: (date: string) => PackageCarrier[],
  mealOptionIndex: ReadonlyMap<string, number>,
): Map<string, MealOption> {
  const selections = new Map<string, MealOption>();
  for (const activity of activities) {
    if (!isMealActivity(activity)) continue;
    const key = activityTimelineKey(activity);
    if (!key) continue;
    const selected = selectedMealOptionOn(
      activity,
      staysOn(key.date),
      carriersOn(key.date),
      key.date,
      key.at,
      mealOptionIndex,
    );
    if (selected) selections.set(activity._id, selected);
  }
  return selections;
}

// An activity's warnings (tripModel.ts's activityWarnings), recomputed live
// for the day as the reader sees it: a still-open meal's were computed at page
// load against its first candidate's format, and switching to a different one
// (a quick self-catered breakfast in place of a sit-down package one) can
// clear or introduce an overlap, so the row shows what's selected right now
// rather than a stale build-time verdict.
//
// Its day's activities come from dayActivities' own per-Day cache, so the
// pairwise scan runs once per (Day, activity) however often rows and filters
// ask (a reviewed false positive on its cost).
// Memoized per live Day and activity (both are rebuilt, never mutated, when
// anything changes): the filters and the row both ask for the same verdict.
const warningsCache = new WeakMap<Day, WeakMap<EnrichedActivity, string[]>>();

export function liveWarnings(activity: EnrichedActivity, day: Day): string[] {
  let byActivity = warningsCache.get(day);
  if (!byActivity) warningsCache.set(day, (byActivity = new WeakMap()));
  let warnings = byActivity.get(activity);
  if (!warnings) {
    warnings = activityWarnings(
      activity,
      dayActivities(day),
      day.transits,
      staysInScope(day.stays, activity),
      day.selectedMeals,
    );
    byActivity.set(activity, warnings);
  }
  return warnings;
}

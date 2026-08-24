// Small pure formatting/vocabulary helpers reused across leg cards, the day
// list, activity rows, and the activity detail side sheet — nothing here is
// scoped to just one of those surfaces (see docs/data-model.html for the
// entity shapes these draw on).
import { activityTimeLabel } from './tripModel';
import type { DiningFormat, Image, Leg, MealOption, MealType } from './types';

// ---------- leg skeleton-authority vocabulary ----------

export const AUTHORITY_OPTIONS: {
  value: Leg['skeletonAuthority'];
  label: string;
  helper: string;
}[] = [
  {
    value: 'self',
    label: 'Self-planned',
    helper: 'You picked these dates/locations — free to shift them later.',
  },
  {
    value: 'operator',
    label: 'Operator-fixed',
    helper: 'An operator (cruise, tour) locked this date/location skeleton in.',
  },
];

// ---------- images: every entity carries images: Image[] — a list rather
// than one field so a hand-sourced reference photo and later personal trip
// photos can coexist. Rendering only ever draws the first entry. ----------
export function firstImage(entity: { images?: Image[] | null } | null | undefined): Image | null {
  return entity?.images?.[0] ?? null;
}

// ---------- dining-format / meal-slot vocabulary ----------

export const DINING_FORMAT_LABEL: Record<DiningFormat, string> = {
  included: 'Included',
  package: 'Package',
  'included-with-activity': 'Included with activity',
  'included-with-transit': 'Included with travel',
  'sit-down': 'Sit-down',
  'grab-and-go': 'Grab-and-go',
  drivethru: 'Drive-thru',
  'self-catered': 'Self-catered',
};

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

// Every day-list row leads with "time · type" on its overline — mealType for
// a meal Activity, 'Activity' for a plain one — matching Depart/Via/Waypoint/
// Arrive's own time-plus-type overline and Stay's relation-only one.
// timeOverride lets MealRow substitute the selected MealOption candidate's
// own calculated time span (mealOptionTimeLabel, in mealOptions.ts) in place
// of the Activity's own — the still-open Activity itself has no
// durationMinutes to compute a span from, only whichever candidate is picked.
export function timeAndMealTypeLabel(
  activity: {
    _id: string;
    startAt: string | null;
    durationMinutes: number | null;
    timeLabel: string | null;
    mealType: MealType | null;
    diningFormat: DiningFormat | null;
    options: MealOption[] | null;
  },
  timeOverride?: string,
): string {
  const time = timeOverride ?? activityTimeLabel(activity);
  return `${time} · ${activity.mealType ? MEAL_TYPE_LABEL[activity.mealType] : 'Activity'}`;
}

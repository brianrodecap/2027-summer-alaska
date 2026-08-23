// Small pure formatting/vocabulary helpers reused across leg cards, the day
// list, activity rows, and the activity detail side sheet — nothing here is
// scoped to just one of those surfaces (see docs/data-model.html for the
// entity shapes these draw on).
import { activityTimeLabel } from './tripModel';
import type { DiningFormat, Image, MealType } from './types';

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
export function timeAndMealTypeLabel(activity: {
  startAt: string | null;
  durationMinutes: number | null;
  timeLabel: string | null;
  mealType: MealType | null;
}): string {
  const time = activityTimeLabel(activity);
  return `${time} · ${activity.mealType ? MEAL_TYPE_LABEL[activity.mealType] : 'Activity'}`;
}

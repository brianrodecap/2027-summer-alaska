// A meal Activity with several still-open MealOption candidates (see
// docs-model.html's Activity entity) needs to know which candidates are
// still actually choosable today, and what to call whichever one's selected
// — logic shared by the meal row and the activity detail panel, so it lives
// here rather than inside either's own component file.
import { stayRelation } from './tripModel';
import { DINING_FORMAT_LABEL } from './formatting';
import type { Day, EnrichedMealOption, Ref } from './types';

// Which Stay a MealOption's includedIn ref is actually about — a plain
// { entity: 'stay' } ref for 'included', or a { entity: 'package' } ref for
// 'package', which requires looking inside each day.stays' own packages[] to
// find the one that owns that package id.
function stayForIncludedIn(day: Day, includedIn: Ref | null) {
  if (!includedIn || !('entity' in includedIn)) return null;
  if (includedIn.entity === 'stay') return day.stays.find((s) => s._id === includedIn.id) ?? null;
  if (includedIn.entity === 'package') {
    return day.stays.find((s) => s.packages?.some((p) => p._id === includedIn.id)) ?? null;
  }
  return null;
}

// An 'included' or 'package' candidate only actually reads as covered once its
// stay is underway — this same day, before check-in has happened, there's no
// room to have gotten breakfast bundled (or package-covered) into yet. Any
// other diningFormat has no such precondition.
function isIncludedOptionActive(day: Day, option: EnrichedMealOption): boolean {
  if (option.diningFormat !== 'included' && option.diningFormat !== 'package') return true;
  const stay = stayForIncludedIn(day, option.includedIn);
  return !!stay && stayRelation(stay, day.date) !== 'Check in';
}

// activity.options is only ever set while a meal is genuinely undecided
// among named candidates.
export function activeMealOptions(activity: { options: EnrichedMealOption[] | null }, day: Day): EnrichedMealOption[] {
  return (activity.options ?? []).filter((option) => isIncludedOptionActive(day, option));
}

export function mealOptionLabel(option: EnrichedMealOption): string {
  return option.place ? option.place.label : DINING_FORMAT_LABEL[option.diningFormat];
}

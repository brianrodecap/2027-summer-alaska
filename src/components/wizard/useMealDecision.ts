import { type Dispatch, type SetStateAction, useMemo, useState } from 'react';

import {
  type ActivityFormState,
  changeMealDecisionForm,
  findDuplicateMealActivity,
  type MealDecision,
} from '../../model/editForms';
import type { Activity } from '../../model/types';

// The mealDecision/setMealDecision pair plus the form-patching onChange that
// keeps activityForm in sync — identical between AddEventWizard and
// EditEventWizard, so both call this instead of each keeping its own copy
// that could silently drift.
export function useMealDecision(
  initial: MealDecision,
  setActivityForm: Dispatch<SetStateAction<ActivityFormState>>,
): [MealDecision, (next: MealDecision) => void] {
  const [mealDecision, setMealDecision] = useState<MealDecision>(initial);
  const onMealDecisionChange = (next: MealDecision) => {
    setActivityForm((f) => changeMealDecisionForm(f, next));
    setMealDecision(next);
  };
  return [mealDecision, onMealDecisionChange];
}

// The duplicateMealActivity lookup plus the mergeIntoDuplicate answer it
// gates — identical between AddEventWizard and EditEventWizard (down to the
// null-until-answered default; see isMergingIntoDuplicate's own comment for
// why a true default would be wrong), so both call this instead of each
// keeping its own copy that could silently drift. `excludeId` is the entity
// being edited itself, so EditEventWizard doesn't "find" its own draft as a
// duplicate of itself — AddEventWizard has no existing entity yet, so it
// never passes one.
export function useMealDuplicateMerge(
  activities: Activity[],
  activityForm: ActivityFormState,
  excludeId?: string,
): {
  duplicateMealActivity: Activity | null;
  mergeIntoDuplicate: boolean | null;
  setMergeIntoDuplicate: Dispatch<SetStateAction<boolean | null>>;
} {
  const [mergeIntoDuplicate, setMergeIntoDuplicate] = useState<boolean | null>(null);
  const duplicateMealActivity = useMemo(
    () =>
      findDuplicateMealActivity(
        activities,
        activityForm.mealType,
        activityForm.startsDate,
        activityForm.startsTime,
        excludeId,
      ),
    [
      activities,
      activityForm.mealType,
      activityForm.startsDate,
      activityForm.startsTime,
      excludeId,
    ],
  );
  return { duplicateMealActivity, mergeIntoDuplicate, setMergeIntoDuplicate };
}

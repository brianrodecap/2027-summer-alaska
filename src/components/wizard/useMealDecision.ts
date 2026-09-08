import { type Dispatch, type SetStateAction, useState } from 'react';

import {
  type ActivityFormState,
  changeMealDecisionForm,
  type MealDecision,
} from '../../model/editForms';

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

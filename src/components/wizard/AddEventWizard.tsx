import { useMemo, useState } from 'react';

import {
  activityFormFrom,
  type ActivityFormState,
  applyActivityForm,
  applyScenarioForm,
  applyStayForm,
  applyTransitForm,
  blankActivity,
  blankScenario,
  blankStay,
  blankTransit,
  type EditKind,
  type Entity,
  mealMergeTarget,
  mergeMealOptionIntoActivity,
  stayFormFrom,
  type StayFormState,
  transitFormFrom,
  type TransitFormState,
  type WizardCategory,
  wizardStepCanProceed,
  wizardStepsForCategory,
} from '../../model/editForms';
import { resolveScenarioDates } from '../../model/tripModel';
import type { Activity, Leg, Route, Scenario, Stay, Transit, Traveler } from '../../model/types';
import { renderWizardStep, type WizardStepContext } from './renderWizardStep';
import { useMealDecision, useMealDuplicateMerge } from './useMealDecision';
import { WizardShell, type WizardStep } from './WizardShell';

// The "Add to this day" wizard — unlike EditEventWizard, the kind isn't
// fixed going in (that's what the category step decides), so this owns a
// blank ActivityFormState/StayFormState/TransitFormState/Scenario draft for
// every category up front, keyed to `legId`/`date` rather than any existing
// entity. Only the one matching the chosen category is ever turned into a
// real saved document, at Finish.
export function AddEventWizard({
  legId,
  date,
  activeScenarioId,
  stays,
  activities,
  transits,
  scenarios,
  legs,
  tripTravelers,
  routes,
  onClose,
  onSaveEntity,
  onSaveScenario,
}: {
  legId: string;
  date: string;
  // The scenario branch this day is currently showing (null on a
  // non-branching day, or one with no scenario tab actively selected) — new
  // Activities are tagged with it so they land in whichever branch was on
  // screen when "Add to this day" was clicked, and meal-duplicate detection
  // (see findDuplicateMealActivity) never folds this draft into another
  // branch's own meal just because it falls on the same date.
  activeScenarioId: string | null;
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
  scenarios: Scenario[];
  legs: Leg[];
  tripTravelers: Traveler[];
  routes: Route[];
  onClose: () => void;
  onSaveEntity: (kind: EditKind, entity: Entity) => void;
  onSaveScenario: (scenario: Scenario) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<WizardCategory>('activity');

  const [activityForm, setActivityForm] = useState<ActivityFormState>(() =>
    activityFormFrom(blankActivity(legId, date, activeScenarioId)),
  );
  // Most meals get jotted down before a place is settled on — "still
  // deciding" is the far more common starting point than "I already know
  // exactly where."
  const [mealDecision, handleMealDecisionChange] = useMealDecision('undecided', setActivityForm);
  const [stayForm, setStayForm] = useState<StayFormState>(() =>
    stayFormFrom(blankStay(legId, date)),
  );
  const [transitForm, setTransitForm] = useState<TransitFormState>(() =>
    transitFormFrom(blankTransit(legId, date)),
  );
  const [scenarioForm, setScenarioForm] = useState<Scenario>(() => blankScenario(legId, date));
  const dateInfoById = useMemo(
    () => resolveScenarioDates(scenarios, activities, transits),
    [scenarios, activities, transits],
  );
  const { duplicateMealActivity, mergeIntoDuplicate, setMergeIntoDuplicate } =
    useMealDuplicateMerge(activities, activityForm, activeScenarioId);

  const stepIds = wizardStepsForCategory(category, {
    lead: 'category',
    duplicateMealActivity,
  });

  const ctx: WizardStepContext = {
    category,
    onCategoryChange: setCategory,
    mealDecision,
    onMealDecisionChange: handleMealDecisionChange,
    duplicateMealActivity,
    mergeIntoDuplicate,
    onMergeIntoDuplicateChange: setMergeIntoDuplicate,
    activityForm,
    onActivityFormChange: setActivityForm,
    stayForm,
    onStayFormChange: setStayForm,
    transitForm,
    onTransitFormChange: setTransitForm,
    scenarioForm,
    onScenarioFormChange: setScenarioForm,
    stays,
    activities,
    transits,
    tripTravelers,
    routes,
    legs,
    otherScenarios: scenarios,
    dateInfoById,
  };

  const steps: WizardStep[] = stepIds.map((id) => ({
    id,
    content: renderWizardStep(id, ctx),
    canProceed: wizardStepCanProceed(id, {
      activityForm,
      stayForm,
      transitForm,
      scenarioForm,
      duplicateMealActivity,
      mergeIntoDuplicate,
    }),
  }));

  const handleFinish = () => {
    if (category === 'scenario') {
      const clone = structuredClone(scenarioForm);
      const message = applyScenarioForm(clone, scenarioForm, scenarios);
      if (message) {
        setError(message);
        return;
      }
      onSaveScenario(clone);
      return;
    }
    if (category === 'stay') {
      const entity = blankStay(legId, date);
      const message = applyStayForm(entity, stayForm);
      if (message) {
        setError(message);
        return;
      }
      onSaveEntity('stay', entity);
      return;
    }
    if (category === 'transit') {
      const entity = blankTransit(legId, date);
      const message = applyTransitForm(entity, transitForm);
      if (message) {
        setError(message);
        return;
      }
      onSaveEntity('transit', entity);
      return;
    }
    const entity = blankActivity(legId, date, activeScenarioId);
    const message = applyActivityForm(entity, activityForm);
    if (message) {
      setError(message);
      return;
    }
    // Merging reuses the duplicate Activity's own id, so onSaveEntity's
    // upsert (DaysView.tsx) replaces it in place rather than adding entity
    // as a second, competing Activity.
    const mergeTarget = mealMergeTarget(category, duplicateMealActivity, mergeIntoDuplicate);
    if (mergeTarget) {
      onSaveEntity('activity', mergeMealOptionIntoActivity(mergeTarget, activityForm));
      return;
    }
    onSaveEntity('activity', entity);
  };

  return (
    <WizardShell
      title="Add to this day"
      steps={steps}
      onCancel={onClose}
      onFinish={handleFinish}
      finishLabel="Add"
      error={error}
      onDismissError={() => setError(null)}
    />
  );
}

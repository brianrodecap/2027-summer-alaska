import { useState } from 'react';

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
  type MealDecision,
  stayFormFrom,
  type StayFormState,
  transitFormFrom,
  type TransitFormState,
  type WizardCategory,
  wizardStepCanProceed,
  wizardStepsForCategory,
} from '../../model/editForms';
import type { Activity, Leg, Route, Scenario, Stay, Transit, Traveler } from '../../model/types';
import { renderWizardStep, type WizardStepContext } from './renderWizardStep';
import { WizardShell, type WizardStep } from './WizardShell';

type Entity = Activity | Stay | Transit;

// The "Add to this day" wizard — unlike EditEventWizard, the kind isn't
// fixed going in (that's what the category step decides), so this owns a
// blank ActivityFormState/StayFormState/TransitFormState/Scenario draft for
// every category up front, keyed to `legId`/`date` rather than any existing
// entity. Only the one matching the chosen category is ever turned into a
// real saved document, at Finish.
export function AddEventWizard({
  legId,
  date,
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
  const [mealDecision, setMealDecision] = useState<MealDecision>('decided');

  const [activityForm, setActivityForm] = useState<ActivityFormState>(() =>
    activityFormFrom(blankActivity(legId, date)),
  );
  const [stayForm, setStayForm] = useState<StayFormState>(() =>
    stayFormFrom(blankStay(legId, date)),
  );
  const [transitForm, setTransitForm] = useState<TransitFormState>(() =>
    transitFormFrom(blankTransit(legId, date)),
  );
  const [scenarioForm, setScenarioForm] = useState<Scenario>(() => blankScenario(legId, date));

  const stepIds = wizardStepsForCategory(category, {
    mealDecision,
    hasTravelers: tripTravelers.length > 0,
    lead: 'category',
  });

  const ctx: WizardStepContext = {
    category,
    onCategoryChange: setCategory,
    mealDecision,
    onMealDecisionChange: setMealDecision,
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
  };

  const steps: WizardStep[] = stepIds.map((id) => ({
    id,
    content: renderWizardStep(id, ctx),
    canProceed: wizardStepCanProceed(id, { activityForm, stayForm, transitForm, scenarioForm }),
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
    const entity = blankActivity(legId, date);
    const message = applyActivityForm(entity, activityForm);
    if (message) {
      setError(message);
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

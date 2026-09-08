import type { ReactNode } from 'react';

import type {
  ActivityFormState,
  MealDecision,
  StayFormState,
  TransitFormState,
  WizardCategory,
  WizardStepId,
} from '../../model/editForms';
import { isMergingIntoDuplicate } from '../../model/editForms';
import type { ScenarioDateInfo } from '../../model/tripModel';
import type { Activity, Leg, Route, Scenario, Stay, Transit, Traveler } from '../../model/types';
import { ScenarioEditForm } from '../edit/ScenarioEditForm';
import { LodgingField, StayWhenFields, TransitEndpointFields } from '../edit/StayTransitFields';
import {
  ActivityReview,
  ActivityWhereWhenStep,
  BookingStep,
  CategoryStep,
  DetailsStep,
  MealBranchStep,
  MealDecisionStep,
  MealDuplicateStep,
  MealWhatStep,
  MealWhereWhenStep,
  ScenarioReview,
  StayReview,
  TransitReview,
  TransitRouteStep,
  TransitWhenStep,
} from './WizardStepContent';

// Everything any step's content might need — assembled once by the
// orchestrating wizard (AddEventWizard/EditEventWizard) and threaded
// through here so those two only own state and the step *list*, not the
// step *content*'s own wiring. Not every field is read by every step —
// e.g. `legs`/`otherScenarios` only matter for scenarioDetails.
export interface WizardStepContext {
  category: WizardCategory;
  onCategoryChange: (category: WizardCategory) => void;
  mealDecision: MealDecision;
  onMealDecisionChange: (decision: MealDecision) => void;
  activityForm: ActivityFormState;
  onActivityFormChange: (form: ActivityFormState) => void;
  stayForm: StayFormState;
  onStayFormChange: (form: StayFormState) => void;
  transitForm: TransitFormState;
  onTransitFormChange: (form: TransitFormState) => void;
  // scenarioForm/onScenarioFormChange/legs/otherScenarios are only
  // reachable via AddEventWizard's 'scenarioDetails'/'review' steps
  // (EditEventWizard's kind is always fixed to activity/stay/transit, so
  // its category can never be 'scenario') — omitted there rather than
  // filled with throwaway drafts/empty arrays.
  scenarioForm?: Scenario;
  onScenarioFormChange?: (scenario: Scenario) => void;
  // Only AddEventWizard's 'meal' category ever populates these (see
  // findDuplicateMealActivity) — EditEventWizard never reaches the
  // 'mealDuplicate' step, so it has nothing to supply here.
  duplicateMealActivity?: Activity | null;
  mergeIntoDuplicate?: boolean;
  onMergeIntoDuplicateChange?: (merge: boolean) => void;
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
  tripTravelers: Traveler[];
  routes: Route[];
  legs?: Leg[];
  otherScenarios?: Scenario[];
  dateInfoById?: Map<string, ScenarioDateInfo>;
}

function renderBookingStep(ctx: WizardStepContext): ReactNode {
  if (ctx.category === 'stay') {
    return (
      <BookingStep
        value={ctx.stayForm.booking}
        onChange={(booking) => ctx.onStayFormChange({ ...ctx.stayForm, booking })}
      />
    );
  }
  if (ctx.category === 'transit') {
    return (
      <BookingStep
        value={ctx.transitForm.booking}
        onChange={(booking) => ctx.onTransitFormChange({ ...ctx.transitForm, booking })}
      />
    );
  }
  return (
    <BookingStep
      value={ctx.activityForm.booking}
      onChange={(booking) => ctx.onActivityFormChange({ ...ctx.activityForm, booking })}
    />
  );
}

function renderReviewStep(ctx: WizardStepContext): ReactNode {
  switch (ctx.category) {
    case 'stay':
      return <StayReview form={ctx.stayForm} />;
    case 'transit':
      return <TransitReview form={ctx.transitForm} routes={ctx.routes} />;
    case 'scenario':
      // Only AddEventWizard's category can ever reach 'scenario', and it
      // always supplies scenarioForm.
      return <ScenarioReview form={ctx.scenarioForm!} />;
    default:
      return <ActivityReview form={ctx.activityForm} category={ctx.category} />;
  }
}

export function renderWizardStep(stepId: WizardStepId, ctx: WizardStepContext): ReactNode {
  switch (stepId) {
    case 'category':
      return <CategoryStep value={ctx.category} onChange={ctx.onCategoryChange} />;
    case 'mealBranch':
      return (
        <MealBranchStep
          isMeal={ctx.category === 'meal'}
          onChange={(isMeal) => ctx.onCategoryChange(isMeal ? 'meal' : 'activity')}
        />
      );
    case 'stayDetails':
      return <LodgingField form={ctx.stayForm} onChange={ctx.onStayFormChange} />;
    case 'stayWhen':
      return <StayWhenFields form={ctx.stayForm} onChange={ctx.onStayFormChange} />;
    case 'transitWhere':
      return <TransitEndpointFields form={ctx.transitForm} onChange={ctx.onTransitFormChange} />;
    case 'transitRoute':
      return (
        <TransitRouteStep
          form={ctx.transitForm}
          onChange={ctx.onTransitFormChange}
          routes={ctx.routes}
        />
      );
    case 'transitWhen':
      return <TransitWhenStep form={ctx.transitForm} onChange={ctx.onTransitFormChange} />;
    case 'activityWhereWhen':
      return <ActivityWhereWhenStep form={ctx.activityForm} onChange={ctx.onActivityFormChange} />;
    case 'details':
      // A duplicate being merged in discards this form's own description
      // (the merged Activity keeps its existing one) — see
      // mergeMealOptionIntoActivity — so that subsection is skipped rather
      // than collecting an answer that's about to be thrown away.
      return (
        <DetailsStep
          form={ctx.activityForm}
          onChange={ctx.onActivityFormChange}
          tripTravelers={ctx.tripTravelers}
          showDescription={!isMergingIntoDuplicate(ctx)}
          isMeal={ctx.category === 'meal'}
        />
      );
    case 'mealWhat':
      return <MealWhatStep form={ctx.activityForm} onChange={ctx.onActivityFormChange} />;
    case 'mealDuplicate':
      return (
        <MealDuplicateStep
          activity={ctx.duplicateMealActivity!}
          merge={ctx.mergeIntoDuplicate ?? true}
          onChange={ctx.onMergeIntoDuplicateChange!}
        />
      );
    case 'mealDecision':
      return <MealDecisionStep decision={ctx.mealDecision} onChange={ctx.onMealDecisionChange} />;
    case 'mealWhereWhen':
      // A duplicate being merged in always becomes exactly one new
      // candidate (mergeMealOptionIntoActivity) — single-place mode here
      // regardless of mealDecision, same override the 'details' case above
      // applies when deciding whether its own description subsection runs.
      return (
        <MealWhereWhenStep
          form={ctx.activityForm}
          onChange={ctx.onActivityFormChange}
          showCandidates={!isMergingIntoDuplicate(ctx) && ctx.mealDecision === 'undecided'}
          stays={ctx.stays}
          activities={ctx.activities}
          transits={ctx.transits}
        />
      );
    case 'booking':
      return renderBookingStep(ctx);
    case 'scenarioDetails':
      // Only AddEventWizard's category can ever reach 'scenarioDetails',
      // and it always supplies scenarioForm/onScenarioFormChange/legs/
      // otherScenarios.
      return (
        <ScenarioEditForm
          form={ctx.scenarioForm!}
          onChange={ctx.onScenarioFormChange!}
          legs={ctx.legs ?? []}
          otherScenarios={ctx.otherScenarios ?? []}
          dateInfoById={ctx.dateInfoById ?? new Map()}
        />
      );
    case 'review':
      return renderReviewStep(ctx);
  }
}

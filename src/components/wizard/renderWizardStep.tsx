import type { ReactNode } from 'react';

import type {
  ActivityFormState,
  MealDecision,
  StayFormState,
  TransitFormState,
  WizardCategory,
  WizardStepId,
} from '../../model/editForms';
import type { Activity, Leg, Route, Scenario, Stay, Transit, Traveler } from '../../model/types';
import { ScenarioEditForm } from '../edit/ScenarioEditForm';
import {
  ActivityPlaceStep,
  ActivityReview,
  ActivityWhatStep,
  ActivityWhenStep,
  BookingStep,
  CategoryStep,
  ExtrasStep,
  MealBranchStep,
  MealDecisionStep,
  MealOptionsStep,
  MealPlaceStep,
  MealWhatStep,
  ScenarioReview,
  StayDetailsStep,
  StayReview,
  StayWhenStep,
  TransitReview,
  TransitRouteStep,
  TransitWhenStep,
  TransitWhereStep,
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
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
  tripTravelers: Traveler[];
  routes: Route[];
  legs?: Leg[];
  otherScenarios?: Scenario[];
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
      return <StayDetailsStep form={ctx.stayForm} onChange={ctx.onStayFormChange} />;
    case 'stayWhen':
      return <StayWhenStep form={ctx.stayForm} onChange={ctx.onStayFormChange} />;
    case 'transitWhere':
      return <TransitWhereStep form={ctx.transitForm} onChange={ctx.onTransitFormChange} />;
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
    case 'activityWhat':
      return <ActivityWhatStep form={ctx.activityForm} onChange={ctx.onActivityFormChange} />;
    case 'activityWhen':
      return <ActivityWhenStep form={ctx.activityForm} onChange={ctx.onActivityFormChange} />;
    case 'activityPlace':
      return <ActivityPlaceStep form={ctx.activityForm} onChange={ctx.onActivityFormChange} />;
    case 'extras':
      return (
        <ExtrasStep
          form={ctx.activityForm}
          onChange={ctx.onActivityFormChange}
          tripTravelers={ctx.tripTravelers}
        />
      );
    case 'mealWhat':
      return <MealWhatStep form={ctx.activityForm} onChange={ctx.onActivityFormChange} />;
    case 'mealWhen':
      return <ActivityWhenStep form={ctx.activityForm} onChange={ctx.onActivityFormChange} />;
    case 'mealDecision':
      return <MealDecisionStep decision={ctx.mealDecision} onChange={ctx.onMealDecisionChange} />;
    case 'mealPlace':
      return (
        <MealPlaceStep
          form={ctx.activityForm}
          onChange={ctx.onActivityFormChange}
          stays={ctx.stays}
          activities={ctx.activities}
          transits={ctx.transits}
        />
      );
    case 'mealOptions':
      return (
        <MealOptionsStep
          form={ctx.activityForm}
          onChange={ctx.onActivityFormChange}
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
        />
      );
    case 'review':
      return renderReviewStep(ctx);
  }
}

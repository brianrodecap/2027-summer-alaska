import Button from '@mui/material/Button';
import { useState } from 'react';

import {
  activityFormFrom,
  type ActivityFormState,
  applyActivityForm,
  applyStayForm,
  applyTransitForm,
  blankActivity,
  blankStay,
  blankTransit,
  categoryForActivity,
  type EditKind,
  type Entity,
  entityDateOnly,
  mealDecisionForActivity,
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
import type { Activity, Route, Stay, Transit, Traveler } from '../../model/types';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { renderWizardStep, type WizardStepContext } from './renderWizardStep';
import { useMealDecision, useMealDuplicateMerge } from './useMealDecision';
import { WizardShell, type WizardStep } from './WizardShell';

const EDIT_TITLE: Record<EditKind, string> = {
  activity: 'Edit activity',
  stay: 'Edit stay',
  transit: 'Edit transit',
};

interface EditEventWizardProps {
  kind: EditKind;
  entity: Entity;
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
  tripTravelers: Traveler[];
  routes: Route[];
  onClose: () => void;
  onSave: (updated: Entity) => void;
  onDelete: (kind: EditKind, id: string) => void;
}

// Keyed by the entity's own id so switching to a different entity (e.g. one
// row's pencil tapped right after another's) resets the wizard's local
// state instead of carrying over stale field values.
export function EditEventWizard(props: EditEventWizardProps) {
  return <EditEventWizardBody {...props} key={props.entity._id} />;
}

function EditEventWizardBody({
  kind,
  entity,
  stays,
  activities,
  transits,
  tripTravelers,
  routes,
  onClose,
  onSave,
  onDelete,
}: EditEventWizardProps) {
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // All three form states are always kept around (rather than just the one
  // matching `kind`) so WizardStepContext never has to special-case a
  // missing form — only the one matching `kind`/`category` is ever actually
  // read back out at Save time. The other two are seeded from the entity
  // being edited's own real date (entityDateOnly), not '' — blankStay's
  // checkOutAt does real Date math via addDaysStr, which throws on ''.
  // Computed via a lazy useState initializer (like the three form states
  // below it) so entityDateOnly only runs once per mount, not on every
  // re-render of this body.
  const [blankDate] = useState(() => entityDateOnly(kind, entity));
  const [activityForm, setActivityForm] = useState<ActivityFormState>(() =>
    activityFormFrom(
      kind === 'activity' ? (entity as Activity) : blankActivity(entity.legId, blankDate),
    ),
  );
  const [stayForm, setStayForm] = useState<StayFormState>(() =>
    stayFormFrom(kind === 'stay' ? (entity as Stay) : blankStay(entity.legId, blankDate)),
  );
  const [transitForm, setTransitForm] = useState<TransitFormState>(() =>
    transitFormFrom(
      kind === 'transit' ? (entity as Transit) : blankTransit(entity.legId, blankDate),
    ),
  );

  // An Activity's own category (plain vs. meal) is derived from its data,
  // not asked again — but stays changeable via the mealBranch step below,
  // same as a Stay/Transit's category is simply fixed to its own kind.
  const [category, setCategory] = useState<WizardCategory>(() =>
    kind === 'activity' ? categoryForActivity(activityForm) : kind,
  );
  const [mealDecision, handleMealDecisionChange] = useMealDecision(
    mealDecisionForActivity(activityForm),
    setActivityForm,
  );
  const { duplicateMealActivity, mergeIntoDuplicate, setMergeIntoDuplicate } =
    useMealDuplicateMerge(activities, activityForm, entity._id);

  const stepIds = wizardStepsForCategory(category, {
    lead: kind === 'activity' ? 'mealBranch' : null,
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
    stays,
    activities,
    transits,
    tripTravelers,
    routes,
  };

  const steps: WizardStep[] = stepIds.map((id) => ({
    id,
    content: renderWizardStep(id, ctx),
    canProceed: wizardStepCanProceed(id, {
      activityForm,
      stayForm,
      transitForm,
      duplicateMealActivity,
      mergeIntoDuplicate,
    }),
  }));

  const handleSave = () => {
    const clone = structuredClone(entity) as Entity;
    const message =
      kind === 'activity'
        ? applyActivityForm(clone as Activity, activityForm)
        : kind === 'stay'
          ? applyStayForm(clone as Stay, stayForm)
          : applyTransitForm(clone as Transit, transitForm);
    if (message) {
      setError(message);
      return;
    }
    // Merging folds this Activity's decided fields into the duplicate as one
    // more candidate (mergeMealOptionIntoActivity) and then removes this
    // entity outright — leaving it in place alongside the newly-merged
    // duplicate would just recreate the unmodeled-duplicate problem this
    // whole flow exists to avoid.
    const mergeTarget = mealMergeTarget(category, duplicateMealActivity, mergeIntoDuplicate);
    if (mergeTarget) {
      onSave(mergeMealOptionIntoActivity(mergeTarget, activityForm));
      onDelete(kind, entity._id);
      return;
    }
    onSave(clone);
  };

  return (
    <>
      <WizardShell
        title={EDIT_TITLE[kind]}
        steps={steps}
        onCancel={onClose}
        onFinish={handleSave}
        finishLabel="Save"
        error={error}
        onDismissError={() => setError(null)}
        deleteSlot={
          <Button color="error" onClick={() => setConfirmingDelete(true)} sx={{ mt: 2 }}>
            Delete this {kind}
          </Button>
        }
      />
      <ConfirmDialog
        open={confirmingDelete}
        title={`Delete this ${kind}?`}
        message="This can't be undone from the app — it removes the entry entirely."
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => onDelete(kind, entity._id)}
      />
    </>
  );
}

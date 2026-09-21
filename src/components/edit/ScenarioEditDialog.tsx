import { useMemo, useState } from 'react';

import { applyScenarioForm, scenarioFormFrom } from '../../model/editForms';
import { scenarioDeletionBlocker } from '../../model/scenarioGroups';
import type { ScenarioDateInfo } from '../../model/tripModel';
import type { Activity, Leg, Scenario, Transit } from '../../model/types';
import { EntityFormDialog } from '../shared/EntityFormDialog';
import { ScenarioEditForm } from './ScenarioEditForm';

// The chrome around ScenarioEditForm — mirrors RouteEditDialog's own shape,
// since a Scenario is likewise reference data an Activity/Transit merely
// points at (scenarioId) rather than a day-list line item scoped to one
// entity id.
export function ScenarioEditDialog({
  scenario,
  isNew,
  legs,
  allScenarios,
  activities,
  transits,
  dateInfoById,
  onClose,
  onSave,
  onDelete,
}: {
  scenario: Scenario;
  isNew: boolean;
  legs: Leg[];
  allScenarios: Scenario[];
  // What a scenario group is derived from (its resolved date), so Save can
  // keep every group at exactly one Ideal member.
  activities: Activity[];
  transits: Transit[];
  // Same resolved-date info ScenariosDialog's own list groups by — reused
  // here so the "Requires one of"/"Parent scenario" pickers can group their
  // otherwise-identical-looking candidates (same "Flight goes"/"Grounded"
  // duplication the list view has) under the same date headers.
  dateInfoById: Map<string, ScenarioDateInfo>;
  onClose: () => void;
  // Commits the scenario; returns a message when the tone invariant refuses it.
  onSave: (scenario: Scenario, isNew: boolean) => string | null;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState<Scenario>(() => scenarioFormFrom(scenario));

  const otherScenarios = allScenarios.filter((s) => s._id !== scenario._id);

  // Two whole-trip scenario derivations — keep them off the per-keystroke
  // form re-render path.
  const deletionBlocker = useMemo(
    () => scenarioDeletionBlocker({ scenarios: allScenarios, activities, transits }, scenario._id),
    [allScenarios, activities, transits, scenario._id],
  );

  const handleSave = (): string | null => {
    const clone = structuredClone(scenario);
    const message = applyScenarioForm(clone, form, allScenarios);
    if (message) return message;
    return onSave(clone, isNew);
  };

  return (
    <EntityFormDialog
      title={isNew ? 'Add scenario' : 'Edit scenario'}
      onClose={onClose}
      onSubmit={handleSave}
      deletion={
        isNew
          ? undefined
          : {
              title: 'Delete this scenario?',
              message:
                "This can't be undone from the app — it removes the scenario entirely. Any Activity/Transit still pointing at it moves back into the day's plain sequence, and any other scenario requiring/parenting it has that reference cleared.",
              onConfirm: () => onDelete(scenario._id),
              blockedReason: deletionBlocker,
            }
      }
    >
      <ScenarioEditForm
        form={form}
        onChange={setForm}
        legs={legs}
        otherScenarios={otherScenarios}
        dateInfoById={dateInfoById}
      />
    </EntityFormDialog>
  );
}

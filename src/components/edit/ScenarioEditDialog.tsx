import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useState } from 'react';

import { applyScenarioForm, scenarioFormFrom } from '../../model/editForms';
import type { ScenarioDateInfo } from '../../model/tripModel';
import type { Leg, Scenario } from '../../model/types';
import { ConfirmDialog } from '../shared/ConfirmDialog';
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
  dateInfoById,
  onClose,
  onSave,
  onDelete,
}: {
  scenario: Scenario;
  isNew: boolean;
  legs: Leg[];
  allScenarios: Scenario[];
  // Same resolved-date info ScenariosDialog's own list groups by — reused
  // here so the "Requires one of"/"Parent scenario" pickers can group their
  // otherwise-identical-looking candidates (same "Flight goes"/"Grounded"
  // duplication the list view has) under the same date headers.
  dateInfoById: Map<string, ScenarioDateInfo>;
  onClose: () => void;
  onSave: (scenario: Scenario) => void;
  onDelete: (id: string) => void;
}) {
  const [form, setForm] = useState<Scenario>(() => scenarioFormFrom(scenario));
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const otherScenarios = allScenarios.filter((s) => s._id !== scenario._id);

  const handleSave = () => {
    const clone = structuredClone(scenario);
    const message = applyScenarioForm(clone, form, allScenarios);
    if (message) {
      setError(message);
      return;
    }
    onSave(clone);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? 'Add scenario' : 'Edit scenario'}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        <ScenarioEditForm
          form={form}
          onChange={setForm}
          legs={legs}
          otherScenarios={otherScenarios}
          dateInfoById={dateInfoById}
        />
      </DialogContent>
      <DialogActions sx={{ justifyContent: 'space-between', px: 3 }}>
        {isNew ? (
          <span />
        ) : (
          <Button color="error" onClick={() => setConfirmingDelete(true)}>
            Delete
          </Button>
        )}
        <div>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="contained" onClick={handleSave}>
            Save
          </Button>
        </div>
      </DialogActions>
      <ConfirmDialog
        open={confirmingDelete}
        title="Delete this scenario?"
        message="This can't be undone from the app — it removes the scenario entirely. Any Activity/Transit still pointing at it moves back into the day's plain sequence, and any other scenario requiring/parenting it has that reference cleared."
        onCancel={() => setConfirmingDelete(false)}
        onConfirm={() => onDelete(scenario._id)}
      />
    </Dialog>
  );
}

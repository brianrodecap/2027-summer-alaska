import Alert from '@mui/material/Alert';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import { useState } from 'react';

import {
  activityFormFrom,
  type ActivityFormState,
  applyActivityForm,
  applyStayForm,
  applyTransitForm,
  stayFormFrom,
  type StayFormState,
  transitFormFrom,
  type TransitFormState,
} from '../../model/editForms';
import type { Activity, Route, Stay, Transit, Traveler } from '../../model/types';
import type { EditKind } from '../../state/EditContext';
import type { CollectionName } from '../../state/TripDataContext';
import { ConfirmDialog } from '../shared/ConfirmDialog';
import { ActivityEditForm } from './ActivityEditForm';
import { StayEditForm } from './StayEditForm';
import { TransitEditForm } from './TransitEditForm';

const EDIT_ENTITY_LABEL: Record<EditKind, string> = {
  activity: 'Edit activity',
  stay: 'Edit stay',
  transit: 'Edit transit',
};

const ADD_ENTITY_LABEL: Record<EditKind, string> = {
  activity: 'Add activity',
  stay: 'Add stay',
  transit: 'Add transit',
};

const DIRTY_COLLECTION: Record<EditKind, CollectionName> = {
  activity: 'activities',
  stay: 'stays',
  transit: 'transits',
};

type Entity = Activity | Stay | Transit;

interface EditDialogProps {
  kind: EditKind;
  entity: Entity | undefined;
  isNew?: boolean;
  stays: Stay[];
  activities: Activity[];
  transits: Transit[];
  tripTravelers: Traveler[];
  routes: Route[];
  onClose: () => void;
  onSave: (updated: Entity, dirty: CollectionName) => void;
  onDelete: (kind: EditKind, id: string) => void;
}

// One shared chrome hosts the form for all three editable line-item kinds —
// opened from a Stay/Transit row's pencil button or the activity side
// sheet's own edit button. There's no backend to write to: Save only ever
// mutates a clone of the in-memory entity; TripDataContext's setData is what
// actually commits it and marks the touched collection dirty for "export
// edits" to pick up later.
export function EditDialog(props: EditDialogProps) {
  const { entity } = props;
  if (!entity) return null;
  // Keyed by the entity's own id so switching to a different entity resets
  // the form's local state instead of carrying over stale field values.
  return <EditDialogBody {...props} entity={entity} key={entity._id} />;
}

function EditDialogBody({
  kind,
  entity,
  isNew,
  stays,
  activities,
  transits,
  tripTravelers,
  routes,
  onClose,
  onSave,
  onDelete,
}: EditDialogProps & { entity: Entity }) {
  const [error, setError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [activityForm, setActivityForm] = useState<ActivityFormState | null>(
    kind === 'activity' ? activityFormFrom(entity as Activity) : null,
  );
  const [stayForm, setStayForm] = useState<StayFormState | null>(
    kind === 'stay' ? stayFormFrom(entity as Stay) : null,
  );
  const [transitForm, setTransitForm] = useState<TransitFormState | null>(
    kind === 'transit' ? transitFormFrom(entity as Transit) : null,
  );

  const handleSave = () => {
    const clone = structuredClone(entity) as Entity;
    let message: string | null = null;
    if (kind === 'activity' && activityForm)
      message = applyActivityForm(clone as Activity, activityForm);
    else if (kind === 'stay' && stayForm) message = applyStayForm(clone as Stay, stayForm);
    else if (kind === 'transit' && transitForm)
      message = applyTransitForm(clone as Transit, transitForm);
    if (message) {
      setError(message);
      return;
    }
    onSave(clone, DIRTY_COLLECTION[kind]);
  };

  return (
    <Dialog open onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>{isNew ? ADD_ENTITY_LABEL[kind] : EDIT_ENTITY_LABEL[kind]}</DialogTitle>
      <DialogContent dividers>
        {error && (
          <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
            {error}
          </Alert>
        )}
        {kind === 'activity' && activityForm && (
          <ActivityEditForm
            form={activityForm}
            onChange={setActivityForm}
            stays={stays}
            activities={activities}
            transits={transits}
            tripTravelers={tripTravelers}
          />
        )}
        {kind === 'stay' && stayForm && <StayEditForm form={stayForm} onChange={setStayForm} />}
        {kind === 'transit' && transitForm && (
          <TransitEditForm form={transitForm} onChange={setTransitForm} routes={routes} />
        )}
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
            {isNew ? 'Add' : 'Save'}
          </Button>
        </div>
      </DialogActions>
      {!isNew && (
        <ConfirmDialog
          open={confirmingDelete}
          title={`Delete this ${kind}?`}
          message="This can't be undone from the app — it removes the entry entirely."
          onCancel={() => setConfirmingDelete(false)}
          onConfirm={() => onDelete(kind, entity._id)}
        />
      )}
    </Dialog>
  );
}

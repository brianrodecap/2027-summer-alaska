import { useState } from 'react';

import {
  activityFormFrom,
  type ActivityFormState,
  applyEntityForm,
  type BookingSource,
  type EditKind,
  stayFormFrom,
  type StayFormState,
  transitFormFrom,
  type TransitFormState,
} from '../../model/editForms';
import type { Activity, Booking, Route, Stay, Transit, Traveler } from '../../model/types';
import { EntityFormDialog } from '../shared/EntityFormDialog';
import { ActivityEditForm } from './ActivityEditForm';
import { StayEditForm } from './StayEditForm';
import { TransitEditForm } from './TransitEditForm';

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
  bookingSource: BookingSource;
  onClose: () => void;
  // Set only while more drafts are queued after this one — see EntityFormDialog.
  onSkip?: () => void;
  // The applied entity plus every Booking document its form wrote — see
  // editForms.ts's applyEntityForm/commitEntityEdit.
  onSave: (updated: Entity, bookings: Booking[]) => void;
  onDelete: (kind: EditKind, id: string) => void;
}

// One shared chrome hosts the form for all three editable line-item kinds —
// opened from a Stay/Transit row's pencil button or the activity side
// sheet's own edit button. Save only ever mutates a clone of the in-memory
// entity; TripDataContext's setData is what actually commits and persists it.
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
  bookingSource,
  onClose,
  onSkip,
  onSave,
  onDelete,
}: EditDialogProps & { entity: Entity }) {
  const [activityForm, setActivityForm] = useState<ActivityFormState | null>(() =>
    kind === 'activity' ? activityFormFrom(entity as Activity, bookingSource) : null,
  );
  const [stayForm, setStayForm] = useState<StayFormState | null>(() =>
    kind === 'stay' ? stayFormFrom(entity as Stay, bookingSource) : null,
  );
  const [transitForm, setTransitForm] = useState<TransitFormState | null>(() =>
    kind === 'transit' ? transitFormFrom(entity as Transit, bookingSource) : null,
  );

  const handleSave = (): string | null => {
    const clone = structuredClone(entity) as Entity;
    const result = applyEntityForm(kind, clone, {
      activity: activityForm,
      stay: stayForm,
      transit: transitForm,
    });
    if ('error' in result) return result.error;
    onSave(clone, result.bookings);
    return null;
  };

  return (
    <EntityFormDialog
      title={`${isNew ? 'Add' : 'Edit'} ${kind}`}
      saveLabel={isNew ? 'Add' : 'Save'}
      onClose={onClose}
      onSkip={onSkip}
      onSubmit={handleSave}
      deletion={
        isNew
          ? undefined
          : {
              title: `Delete this ${kind}?`,
              message: "This can't be undone from the app — it removes the entry entirely.",
              onConfirm: () => onDelete(kind, entity._id),
            }
      }
    >
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
        <TransitEditForm
          form={transitForm}
          onChange={setTransitForm}
          routes={routes}
          tripTravelers={tripTravelers}
        />
      )}
    </EntityFormDialog>
  );
}

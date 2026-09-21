import { useState } from 'react';

import { applyLegForm, blankLegForm } from '../../model/editForms';
import type { Leg } from '../../model/types';
import { EntityFormDialog } from '../shared/EntityFormDialog';
import { LegFormFields } from './LegFormFields';

// Overview's own "Add leg" — mirrors AddTripDialog's Save/Cancel shape, but
// (unlike Add trip) it saves through the already-open trip's own EditContext
// data flow: Save appends to data.legs via setData and marks 'legs' dirty,
// the same as every other create in this app, rather than downloading a new
// file set. No date fields here — a Leg's span is computed from whatever
// Stay/Transit/Activity ends up pointing at it (tripModel.ts's
// legDateRange), so a brand-new Leg simply shows no dates until its first
// entity is added.
export function AddLegDialog({
  tripId,
  onClose,
  onCreate,
}: {
  tripId: string;
  onClose: () => void;
  onCreate: (leg: Leg) => void;
}) {
  const [form, setForm] = useState(() => blankLegForm());

  const handleSave = (): string | null => {
    const result = applyLegForm(form, tripId);
    if (typeof result === 'string') return result;
    onCreate(result.leg);
    return null;
  };

  return (
    <EntityFormDialog title="Add leg" onClose={onClose} onSubmit={handleSave}>
      <LegFormFields form={form} onChange={setForm} />
    </EntityFormDialog>
  );
}

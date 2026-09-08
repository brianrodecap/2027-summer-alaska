import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';

import type { ActivityFormState } from '../../model/editForms';
import { LabelWithTip } from '../shared/LabelWithTip';

// The "show weather"/"show elevation at this place" checkboxes — shared by
// the guided wizard's own Place step (WizardStepContent's ActivityPlaceStep)
// and ActivityEditForm's flat-form Place section (see EditContext's
// via: 'wizard'/'flat' split, each a real reachable edit path), so both
// offer the same toggle instead of just whichever one got written first.
export function PlaceConditionsToggles({
  form,
  onChange,
}: {
  form: ActivityFormState;
  onChange: (form: ActivityFormState) => void;
}) {
  return (
    <Stack>
      <FormControlLabel
        control={
          <Checkbox
            checked={form.showWeatherAtPlace}
            onChange={(e) => onChange({ ...form, showWeatherAtPlace: e.target.checked })}
          />
        }
        label={
          <LabelWithTip
            text="Show weather"
            tip="Adds a live temperature + conditions line under this row. Off by default."
          />
        }
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={form.showElevationAtPlace}
            onChange={(e) => onChange({ ...form, showElevationAtPlace: e.target.checked })}
          />
        }
        label={
          <LabelWithTip
            text="Show elevation"
            tip="Adds a one-line elevation reading under this row. Off by default."
          />
        }
      />
    </Stack>
  );
}

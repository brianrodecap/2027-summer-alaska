import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';

import type { Place } from '../../model/types';
import { LabelWithTip } from '../shared/LabelWithTip';

// The "show weather"/"show elevation at this place" checkboxes for a form's
// place field — used by ActivityEditForm, WizardStepContent's DetailsStep,
// and StayTransitFields' LodgingField/TransitEndpointField (the last passing
// a departure/arrival label override for its endpoint pair). Renders nothing
// without a named place — a toggle is meaningless with nothing to show
// weather/elevation for.
export function PlaceConditionsTogglesFor({
  place,
  onPlaceChange,
  weatherLabel = 'Show weather',
  elevationLabel = 'Show elevation',
}: {
  place: Place | null;
  onPlaceChange: (place: Place) => void;
  weatherLabel?: string;
  elevationLabel?: string;
}) {
  if (!place?.label) return null;
  return (
    <Stack>
      <FormControlLabel
        control={
          <Checkbox
            checked={Boolean(place.showWeather)}
            onChange={(e) => onPlaceChange({ ...place, showWeather: e.target.checked })}
          />
        }
        label={
          <LabelWithTip
            text={weatherLabel}
            tip="Adds a live temperature + conditions line under this row. Off by default."
          />
        }
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={Boolean(place.showElevation)}
            onChange={(e) => onPlaceChange({ ...place, showElevation: e.target.checked })}
          />
        }
        label={
          <LabelWithTip
            text={elevationLabel}
            tip="Adds a one-line elevation reading under this row. Off by default."
          />
        }
      />
    </Stack>
  );
}

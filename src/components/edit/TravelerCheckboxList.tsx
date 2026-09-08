import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { Traveler } from '../../model/types';

// The Activity "who's coming" checklist — shared by the flat
// ActivityEditForm and the wizard's own DetailsStep so the toggle logic and
// caption can't silently drift apart between the two entry points.
export function TravelerCheckboxList({
  travelers,
  selectedIds,
  onChange,
}: {
  travelers: Traveler[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  return (
    <Stack>
      <Typography variant="overline" color="text.secondary">
        Attendees (excursions only — leave all unchecked for everyone)
      </Typography>
      {travelers.map((t) => (
        <FormControlLabel
          key={t.id}
          control={
            <Checkbox
              checked={selectedIds.includes(t.id)}
              onChange={(e) =>
                onChange(
                  e.target.checked
                    ? [...selectedIds, t.id]
                    : selectedIds.filter((id) => id !== t.id),
                )
              }
            />
          }
          label={t.name}
        />
      ))}
    </Stack>
  );
}

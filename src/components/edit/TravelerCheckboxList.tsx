import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { Traveler } from '../../model/types';

// The "who's coming" checklist — shared by the flat ActivityEditForm, the
// wizard's own DetailsStep, and TransitTravelFields so the toggle logic
// can't silently drift apart between entry points.
export function TravelerCheckboxList({
  travelers,
  selectedIds,
  onChange,
  caption = 'Attendees (excursions only — leave all unchecked for everyone)',
}: {
  travelers: Traveler[];
  selectedIds: string[];
  onChange: (ids: string[]) => void;
  caption?: string;
}) {
  return (
    <Stack>
      <Typography variant="overline" color="text.secondary">
        {caption}
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

import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';

// Who's actually part of a day-list row — a meal's resolved attendees, or an
// excursion's own explicitly authored partial roster (see
// tripModel.ts's resolveMealTravelers/resolveExcursionTravelers). First
// names only: compact enough for a day-list row, still legible for a
// four-person family trip.
export function TravelerChips({ names }: { names: string[] | null | undefined }) {
  if (!names?.length) return null;
  return (
    <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', mt: 0.5 }}>
      {names.map((n) => (
        <Chip key={n} label={n.split(' ')[0]} size="small" variant="outlined" />
      ))}
    </Stack>
  );
}

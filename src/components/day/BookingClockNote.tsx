import Typography from '@mui/material/Typography';

import { bookingClockNote } from '../../model/dayClocks';

// Under a booking's time when the booking states it on another clock than its
// place's (clockZone): "Booked on MDT · 9:00am MST here". Nothing otherwise.
// `label` names which time it is when there's more than one ('Check-out').
export function BookingClockNote({
  at,
  bookingZone,
  placeZone,
  label,
}: {
  at: string | null;
  bookingZone: string | null;
  placeZone: string | null | undefined;
  label?: string;
}) {
  const note = at ? bookingClockNote(at, bookingZone, placeZone) : null;
  if (!note) return null;
  return (
    <Typography variant="caption" component="div" sx={{ color: 'tertiary.main', fontWeight: 600 }}>
      {label ? `${label}: ${note}` : note}
    </Typography>
  );
}

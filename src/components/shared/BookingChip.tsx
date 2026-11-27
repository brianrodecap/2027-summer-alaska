import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import type { SxProps, Theme } from '@mui/material/styles';

import { bookingChipDetails } from '../../model/bookingDetails';
import type { Booking, BookingStatus } from '../../model/types';
import { BookingDetails } from './BookingDetails';

const STATUS_COLOR: Record<BookingStatus, 'success' | 'error' | 'warning'> = {
  booked: 'success',
  requested: 'warning',
  planning: 'warning',
  cancelled: 'error',
};

// "Booked", "Requested".
function statusLabel(status: BookingStatus): string {
  return `${status[0].toUpperCase()}${status.slice(1)}`;
}

// A bare status chip ("Booked") for something with a BookingStatus but no
// Booking of its own — a Package.
export function BookingStatusChip({ status }: { status: BookingStatus }) {
  return <Chip size="small" label={statusLabel(status)} color={STATUS_COLOR[status]} />;
}

// Booking is optional on Leg/Stay/Transit/Activity — present only when an
// actual reservation applies (see docs/data-model.html, principle 4). On a
// phone the chip is just the status ("Booked") unless `detailsOnMobile`; the
// full facts are a tap away on the open card.
export function BookingChip({
  booking,
  detailsOnMobile = false,
}: {
  booking: Booking | null | undefined;
  detailsOnMobile?: boolean;
}) {
  if (!booking) return null;
  const details = bookingChipDetails(booking);
  const label = (
    <>
      {statusLabel(booking.status)}
      {details.length > 0 && (
        <Box
          component="span"
          sx={{ display: { xs: detailsOnMobile ? 'inline' : 'none', sm: 'inline' } }}
        >
          {` · ${details.join(' · ')}`}
        </Box>
      )}
    </>
  );
  return (
    <Chip
      size="small"
      icon={<ConfirmationNumberIcon />}
      label={label}
      color={STATUS_COLOR[booking.status]}
      // a long confirmation number wraps rather than being cut off
      sx={{
        alignSelf: 'flex-start',
        maxWidth: '100%',
        height: 'auto',
        minHeight: 24,
        '& .MuiChip-label': { whiteSpace: 'normal', overflowWrap: 'anywhere', py: 0.25 },
      }}
    />
  );
}

// A booking's own view in a dialog (LegDialog): its chip, then its full
// BookingDetails. Renders nothing when there's no booking, same
// as BookingChip itself. `date` and `entityId` are BookingDetails' own; `sx`
// replaces the default top margin.
export function BookingSection({
  booking,
  date,
  entityId,
  sx = { mt: 1.5 },
}: {
  booking: Booking | null | undefined;
  date: string | null;
  entityId: string;
  sx?: SxProps<Theme>;
}) {
  if (!booking) return null;
  return (
    <Box sx={sx}>
      <BookingChip booking={booking} detailsOnMobile />
      {/* Keyed so another booking re-reads its default open state. */}
      <BookingDetails key={booking._id} booking={booking} date={date} entityId={entityId} />
    </Box>
  );
}

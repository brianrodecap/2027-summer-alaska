import ConfirmationNumberIcon from '@mui/icons-material/ConfirmationNumber';
import Chip from '@mui/material/Chip';

import { formatMoney } from '../../model/tripModel';
import type { Booking, BookingStatus } from '../../model/types';

const STATUS_COLOR: Record<BookingStatus, 'success' | 'default' | 'error'> = {
  booked: 'success',
  planning: 'default',
  cancelled: 'error',
};

// Booking is optional on Leg/Stay/Transit/Activity — present only when an
// actual reservation applies (see docs/data-model.html, principle 4).
export function BookingChip({ booking }: { booking: Booking | null | undefined }) {
  if (!booking) return null;
  const bits: string[] = [];
  const cost = formatMoney(booking.cost);
  if (cost) bits.push(cost);
  if (booking.confirmationNumber) bits.push(`Conf# ${booking.confirmationNumber}`);
  const label = `${booking.status[0].toUpperCase()}${booking.status.slice(1)}${bits.length ? ` · ${bits.join(' · ')}` : ''}`;
  return (
    <Chip
      size="small"
      icon={<ConfirmationNumberIcon />}
      label={label}
      color={STATUS_COLOR[booking.status]}
      sx={{ alignSelf: 'flex-start' }}
    />
  );
}

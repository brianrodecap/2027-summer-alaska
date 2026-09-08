import type { Booking, BookingStatus } from '../../model/types';

// '' stands in for "no booking yet" — the Status select's own blank option
// (see BookingFields) is what decides whether a booking exists after Save,
// rather than a separate checkbox alongside it.
export interface BookingFormValue {
  status: BookingStatus | '';
  confirmationNumber: string;
  costAmount: string;
}

export function bookingFormValueFrom(booking: Booking | null | undefined): BookingFormValue {
  return {
    status: booking?.status ?? '',
    confirmationNumber: booking?.confirmationNumber ?? '',
    costAmount: booking?.cost?.amount != null ? String(booking.cost.amount) : '',
  };
}

export function readBookingFormValue(
  value: BookingFormValue,
  currentBooking: Booking | null | undefined,
): Booking | null {
  if (!value.status) return null;
  return {
    status: value.status,
    confirmationNumber: value.confirmationNumber || null,
    cost: value.costAmount
      ? { amount: Number(value.costAmount), currency: currentBooking?.cost?.currency ?? 'USD' }
      : null,
  };
}

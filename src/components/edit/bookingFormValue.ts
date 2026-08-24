import type { Booking, BookingStatus } from '../../model/types';

export interface BookingFormValue {
  hasBooking: boolean;
  status: BookingStatus;
  confirmationNumber: string;
  costAmount: string;
}

export function bookingFormValueFrom(booking: Booking | null | undefined): BookingFormValue {
  return {
    hasBooking: Boolean(booking),
    status: booking?.status ?? 'planning',
    confirmationNumber: booking?.confirmationNumber ?? '',
    costAmount: booking?.cost?.amount != null ? String(booking.cost.amount) : '',
  };
}

export function readBookingFormValue(
  value: BookingFormValue,
  currentBooking: Booking | null | undefined,
): Booking | null {
  if (!value.hasBooking) return null;
  return {
    status: value.status,
    confirmationNumber: value.confirmationNumber || null,
    cost: value.costAmount
      ? { amount: Number(value.costAmount), currency: currentBooking?.cost?.currency ?? 'USD' }
      : null,
  };
}

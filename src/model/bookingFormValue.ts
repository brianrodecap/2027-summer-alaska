import {
  bookedThroughName,
  bookedThroughNumber,
  bookingCost,
  bookingFares,
  bookingFixedCharges,
  fareLinesByTraveler,
  payableDueBy,
  sellerBookedThrough,
} from './bookings';
import type { Booking, BookingStatus, FixedCharge, Money, PassengerFare, Payable } from './types';

// Shared by any "amount" text input that commits straight to a Money field
// (readBookingFormValue below, PackagesField's per-fee cost input) — ''
// means "no cost", otherwise the existing currency carries over rather than
// resetting to a hardcoded default on every edit.
export function moneyFromAmountInput(
  amount: string,
  currentCurrency: string | undefined,
): Money | null {
  return amount ? { amount: Number(amount), currency: currentCurrency ?? 'USD' } : null;
}

// '' stands in for "no booking yet" — the Status select's own blank option
// (see BookingFields) is what decides whether a booking exists after Save,
// rather than a separate checkbox alongside it. `id` is the Booking document
// this form writes — the existing one's, or a fresh id minted once when the
// form is seeded, so reading the form twice yields the same document. `base`
// is the document it was seeded from, carrying every field this form doesn't
// edit (payment dates, ticket numbers) through Save untouched. `covers`
// names every entry the seeded booking pays for — shown as "Covers …" when a
// booking is shared (a round trip's two flights); read-only, never saved.
// The price is edited as its two parts (see Pricing): one per-person amount
// and one fixed amount, each only while it's a single number — fares that
// differ by traveler, or several itemized fixed charges, show read-only.
// Each traveler's fare can also owe later payments (see PaymentDue).
export interface BookingFormValue {
  id: string;
  base: Booking | null;
  covers: string[];
  status: BookingStatus | '';
  confirmationNumber: string;
  perPersonAmount: string;
  fixedAmount: string;
  // When the price is paid (see Payable) — one choice for every fare and
  // fixed charge on the booking, unless they already differ (see
  // hasMixedPayables), in which case each keeps its own.
  payable: Payable | undefined;
  paymentsDue: PaymentDue[];
  bookedThrough: string;
  bookedThroughNumber: string;
  // How `base`'s fares read as a per-person amount, worked out once when the
  // form is seeded; null when they can't (see fareLayout).
  layout: FareLayout | null;
}

// An amount each traveler still owes by a date, on top of the per-person
// amount (an invoice's balance after a deposit). Saved as one more fare line
// per traveler, due by that date. `key` is the row's React key, never saved.
export interface PaymentDue {
  key: string;
  amount: string;
  dueBy: string;
}

export function blankPaymentDue(): PaymentDue {
  return { key: crypto.randomUUID(), amount: '', dueBy: '' };
}

// What's wrong with a payment-due row, or null. Save leaves out a row with no
// date. One due no later than the Payment's own due date still saves, but
// reopens as the per-person amount, the earliest payment being that line.
export function paymentDueError(value: BookingFormValue, row: PaymentDue): string | null {
  if (!row.amount) return null;
  if (!row.dueBy) return 'Pick a date';
  const paymentDueBy = payableDueBy(value.payable);
  return paymentDueBy && row.dueBy <= paymentDueBy ? 'Pick a date after the Payment’s' : null;
}

// A payable as stored: a due or paid date never picked reads as paid.
function storedPayable(payable: Payable | undefined): Payable | undefined {
  if (!payable || payable === 'atProperty') return payable;
  const date = 'dueBy' in payable ? payable.dueBy : payable.paidAt;
  return date ? payable : undefined;
}

// `line` with `payable` stored as storedPayable says — left off when paid.
export function withPayable<T extends { payable?: Payable }>(
  line: T,
  payable: Payable | undefined,
): T {
  const { payable: _old, ...rest } = line;
  const stored = storedPayable(payable);
  return (stored ? { ...rest, payable: stored } : rest) as T;
}

const payableKey = (p: Payable | undefined) => JSON.stringify(p ?? null);

// The one Payment choice every line shares; none when they differ, so it
// never depends on which line happens to be listed first.
function commonPayable(lines: { payable?: Payable }[]): Payable | undefined {
  const [first] = lines;
  return first && lines.every((l) => payableKey(l.payable) === payableKey(first.payable))
    ? first.payable
    : undefined;
}

export function bookingFormValueFrom(
  booking: Booking | null | undefined,
  covers: string[] = [],
): BookingFormValue {
  const layout = fareLayout(booking);
  const fixed = bookingFixedCharges(booking) ?? [];
  return {
    id: booking?._id ?? crypto.randomUUID(),
    base: booking ?? null,
    covers: booking ? covers : [],
    status: booking?.status ?? '',
    confirmationNumber: booking?.confirmationNumber ?? '',
    perPersonAmount: layout ? String(layout.mains[0].fare.amount) : '',
    fixedAmount: fixed.length === 1 ? String(fixed[0].amount.amount) : '',
    payable: commonPayable([...paymentFares(booking, layout), ...fixed]),
    paymentsDue: (layout?.due ?? []).map((d) => ({
      ...blankPaymentDue(),
      amount: String(d.fare.fare.amount),
      dueBy: d.dueBy,
    })),
    bookedThrough: bookedThroughName(booking?.bookedThrough),
    bookedThroughNumber: bookedThroughNumber(booking?.bookedThrough),
    layout,
  };
}

interface DueLine {
  fare: PassengerFare;
  dueBy: string;
}

// One traveler's fare lines as the form edits them: the line the Payment
// choice covers, and the amounts due by later dates. When every line is due
// by a date, the earliest is the Payment line. null for any other split (two
// lines already paid). The ticket number moves to the Payment line, since
// Save rebuilds the payments due.
function fareParts(lines: PassengerFare[]): { main: PassengerFare; due: DueLine[] } | null {
  const parts = farePartsAsStored(lines);
  const ticketNumber = lines.find((f) => f.ticketNumber != null)?.ticketNumber;
  return parts && ticketNumber != null
    ? { ...parts, main: { ...parts.main, ticketNumber } }
    : parts;
}

function farePartsAsStored(lines: PassengerFare[]): { main: PassengerFare; due: DueLine[] } | null {
  const due: DueLine[] = [];
  const rest: PassengerFare[] = [];
  for (const fare of lines) {
    const dueBy = payableDueBy(fare.payable);
    if (dueBy === null) rest.push(fare);
    else due.push({ fare, dueBy });
  }
  due.sort((a, b) => a.dueBy.localeCompare(b.dueBy) || a.fare.fare.amount - b.fare.fare.amount);
  if (rest.length > 1) return null;
  if (rest.length === 1) return { main: rest[0], due };
  return due.length ? { main: due[0].fare, due: due.slice(1) } : null;
}

// The fares as one per-person amount plus the same payments due for every
// traveler: each traveler's Payment line, and the payments due they all
// share. null when the travelers' fares differ (a cruise's adult and child
// fares) or are split some other way.
interface FareLayout {
  mains: PassengerFare[];
  due: DueLine[];
}

function fareLayout(booking: Booking | null | undefined): FareLayout | null {
  const parts: NonNullable<ReturnType<typeof fareParts>>[] = [];
  for (const lines of fareLinesByTraveler(booking)) {
    const p = fareParts(lines);
    if (!p) return null;
    parts.push(p);
  }
  const signature = (p: (typeof parts)[number]) =>
    JSON.stringify([p.main.fare.amount, ...p.due.map((d) => [d.fare.fare.amount, d.dueBy])]);
  if (!parts.length || new Set(parts.map(signature)).size > 1) return null;
  return { mains: parts.map((p) => p.main), due: parts[0].due };
}

// The fare lines the Payment choice covers: each traveler's Payment line, or
// every line when the form can't read them that way.
function paymentFares(
  booking: Booking | null | undefined,
  layout: FareLayout | null,
): PassengerFare[] {
  return layout?.mains ?? bookingFares(booking) ?? [];
}

// Fares that differ by traveler (a cruise's adult and child fares), or are
// split into payment lines other than payments due, can't be one per-person
// number, so BookingFields shows them read-only and Save keeps them as they
// are; likewise several itemized fixed charges.
export function hasVaryingFares(value: BookingFormValue): boolean {
  return !!bookingFares(value.base) && !value.layout;
}

// Lines paid at different times (a fare paid now, a fee at the property)
// can't share one Payment choice, so the form leaves each as it is.
export function hasMixedPayables(value: BookingFormValue): boolean {
  const lines = [
    ...paymentFares(value.base, value.layout),
    ...(bookingFixedCharges(value.base) ?? []),
  ];
  return lines.some((l) => payableKey(l.payable) !== payableKey(lines[0].payable));
}

export function hasItemizedFixedCharges(value: BookingFormValue): boolean {
  return (bookingFixedCharges(value.base)?.length ?? 0) > 1;
}

// The id of the Booking a form writes, without building the document —
// readBookingFormValue's own null case, else its _id.
export function bookingIdFromForm(value: BookingFormValue): string | null {
  return value.status ? value.id : null;
}

// `travelerIds` is who a per-person amount applies to when the booking has
// no fares yet — the entry's own travelers, or the whole party. A booking
// that already has fares keeps the same travelers (and ticket numbers).
export function readBookingFormValue(
  value: BookingFormValue,
  travelerIds: string[],
): Booking | null {
  if (!value.status) return null;
  const base = value.base;
  const currency = bookingCost(base)?.currency;
  const baseFares = paymentFares(base, value.layout);
  const baseFixed = bookingFixedCharges(base) ?? [];
  const perPerson = moneyFromAmountInput(value.perPersonAmount, currency);
  const varying = hasVaryingFares(value);
  const baseTravelers = fareLinesByTraveler(base).map(([f]) => f.travelerId);
  const travelers = baseTravelers.length ? baseTravelers : travelerIds;
  const fares: PassengerFare[] = varying
    ? baseFares
    : perPerson
      ? travelers.map((travelerId) => ({
          ...baseFares.find((f) => f.travelerId === travelerId),
          travelerId,
          fare: perPerson,
        }))
      : [];
  // Payments due go with a per-person amount, and need a date.
  const due = value.paymentsDue.flatMap(({ amount, dueBy }) => {
    const fare = moneyFromAmountInput(amount, currency);
    return fare && dueBy && perPerson ? [{ fare, dueBy }] : [];
  });
  const fixedMoney = moneyFromAmountInput(value.fixedAmount, currency);
  const charges: FixedCharge[] = hasItemizedFixedCharges(value)
    ? baseFixed
    : fixedMoney
      ? [{ ...baseFixed[0], label: baseFixed[0]?.label ?? 'Fixed', amount: fixedMoney }]
      : [];
  // One Payment choice covers every line, unless they already differed.
  const mixed = hasMixedPayables(value);
  const paid = mixed ? fares : fares.map((f) => withPayable(f, value.payable));
  // Each traveler's payments due follow their own fare line.
  const perTraveler = varying
    ? paid
    : travelers.flatMap((travelerId) => [
        ...paid.filter((f) => f.travelerId === travelerId),
        ...due.map(({ fare, dueBy }) =>
          withPayable<PassengerFare>({ travelerId, fare }, { dueBy }),
        ),
      ]);
  const fixed = mixed ? charges : charges.map((c) => withPayable(c, value.payable));
  const pricing: Booking['pricing'] =
    perTraveler.length || fixed.length ? { perTraveler, fixed } : null;
  const booking: Booking = {
    ...base,
    _id: value.id,
    status: value.status,
    pricing,
    confirmationNumber: value.confirmationNumber || null,
  };
  const bookedThrough = sellerBookedThrough(value.bookedThrough, value.bookedThroughNumber);
  if (bookedThrough) booking.bookedThrough = bookedThrough;
  else delete booking.bookedThrough;
  return booking;
}

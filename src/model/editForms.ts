// Form-state shapes and pure apply functions for the edit dialog — a direct
// port of edit.js's per-kind read/apply logic, adapted to read a plain form
// object instead of a DOM formEl. Each applyXyzEdit function mutates the
// entity passed in (the caller passes a clone — see EditContext) and
// returns null on success or a message to show inline, exactly like the
// original.
import {
  type BookingFormValue,
  bookingFormValueFrom,
  readBookingFormValue,
} from '../components/edit/BookingFields';
import type {
  Activity,
  DiningFormat,
  Leg,
  MealOption,
  MealType,
  Place,
  PlanStatus,
  Priority,
  Route,
  Stay,
  TimeLabel,
  Transit,
  Trip,
} from './types';

// ---------- blank entities, for the day list's own "Add" button ----------
//
// Each starts with just enough filled in to place it on the day it was
// added from (legId, plus a same-day date/time default) — every other field
// is left at its "nothing decided yet" value, same as an author would leave
// it blank in the JSON. The edit dialog's own validation (applyActivityForm
// et al.) is what forces a real time to be entered before Save.

export function blankActivity(legId: string, date: string): Activity {
  return {
    _id: crypto.randomUUID(),
    legId,
    scenarioId: null,
    status: 'planning',
    startAt: null,
    endAt: null,
    timeLabel: null,
    date,
    order: null,
    priority: null,
    text: '',
    place: null,
    booking: null,
    mealType: null,
    diningFormat: null,
    includedIn: null,
    options: null,
    travelers: null,
    images: [],
  };
}

export function blankStay(legId: string, date: string): Stay {
  return {
    _id: crypto.randomUUID(),
    legId,
    checkInAt: `${date}T15:00`,
    checkOutAt: `${date}T15:00`,
    status: 'planning',
    lodging: { placeId: null, name: '' },
    booking: null,
    packages: null,
    images: [],
  };
}

export function blankTransit(legId: string, date: string): Transit {
  return {
    _id: crypto.randomUUID(),
    legId,
    journeyId: null,
    scenarioId: null,
    status: 'planning',
    mode: 'drive',
    from: { id: null, label: '' },
    to: { id: null, label: '' },
    departsAt: `${date}T09:00`,
    arrivesAt: null,
    routeId: null,
    routeVariant: null,
    booking: null,
    images: [],
  };
}

// ---------- Activity ----------

export interface ActivityFormState {
  startsDate: string | null;
  startsTime: string | null;
  endsDate: string | null;
  endsTime: string | null;
  timeLabel: TimeLabel | '';
  text: string;
  status: PlanStatus;
  priority: Priority | '';
  mealType: MealType | '';
  diningFormat: DiningFormat | '';
  place: Place | null;
  options: MealOption[];
  travelerIds: string[];
  booking: BookingFormValue;
}

// Starts' date field carries activity.date when there's no startAt — the
// only way a fuzzy-timeLabel activity's date ever reaches the form at all.
export function activityFormFrom(activity: Activity): ActivityFormState {
  const startsDate = activity.startAt ? activity.startAt.slice(0, 10) : (activity.date ?? null);
  const startsTime = activity.startAt ? activity.startAt.slice(11, 16) : null;
  const endsDate = activity.endAt ? activity.endAt.slice(0, 10) : null;
  const endsTime = activity.endAt ? activity.endAt.slice(11, 16) : null;
  return {
    startsDate,
    startsTime,
    endsDate,
    endsTime,
    timeLabel: activity.timeLabel ?? '',
    text: activity.text,
    status: activity.status,
    priority: activity.priority ?? '',
    mealType: activity.mealType ?? '',
    diningFormat: activity.diningFormat ?? '',
    place: activity.place,
    options: activity.options ?? [],
    travelerIds: activity.travelers ?? [],
    booking: bookingFormValueFrom(activity.booking),
  };
}

// Every Activity must resolve to both a real sort position and a real date
// — startAt, endAt, or a Starts date paired with a fuzzy timeLabel. An exact
// Starts/Ends always wins over the fuzzy time select when both are given.
export function applyActivityForm(activity: Activity, form: ActivityFormState): string | null {
  const text = form.text.trim();
  if (!text) return 'Needs a description.';
  const startAt =
    form.startsDate && form.startsTime ? `${form.startsDate}T${form.startsTime}` : null;
  const endAt = form.endsDate && form.endsTime ? `${form.endsDate}T${form.endsTime}` : null;
  activity.text = text;
  activity.status = form.status;
  activity.priority = form.priority || null;
  if (startAt || endAt) {
    activity.startAt = startAt;
    activity.endAt = endAt;
    activity.timeLabel = null;
    activity.date = null;
  } else if (form.startsDate && form.timeLabel) {
    activity.startAt = null;
    activity.endAt = null;
    activity.date = form.startsDate;
    activity.timeLabel = form.timeLabel;
  } else {
    return 'Needs a start/end time, or a Starts date with a fuzzy time.';
  }
  activity.mealType = form.mealType || null;
  // A non-empty candidate list always wins: options and the Activity's own
  // place/diningFormat/includedIn are mutually exclusive — any candidates
  // present here mean this meal is still genuinely undecided, so the
  // decided single-answer fields get cleared back to null.
  if (form.options.length) {
    activity.options = form.options;
    activity.place = null;
    activity.diningFormat = null;
    activity.includedIn = null;
  } else {
    activity.options = null;
    activity.place = form.place;
    activity.diningFormat = form.diningFormat || null;
  }
  activity.travelers = form.travelerIds.length ? form.travelerIds : null;
  activity.booking = readBookingFormValue(form.booking, activity.booking);
  return null;
}

// ---------- Stay ----------

export interface StayFormState {
  lodgingName: string;
  checkInDate: string | null;
  checkInTime: string | null;
  checkOutDate: string | null;
  checkOutTime: string | null;
  booking: BookingFormValue;
}

export function stayFormFrom(stay: Stay): StayFormState {
  return {
    lodgingName: stay.lodging?.name ?? '',
    checkInDate: stay.checkInAt.slice(0, 10),
    checkInTime: stay.checkInAt.slice(11, 16),
    checkOutDate: stay.checkOutAt.slice(0, 10),
    checkOutTime: stay.checkOutAt.slice(11, 16),
    booking: bookingFormValueFrom(stay.booking),
  };
}

export function applyStayForm(stay: Stay, form: StayFormState): string | null {
  const checkInAt =
    form.checkInDate && form.checkInTime ? `${form.checkInDate}T${form.checkInTime}` : null;
  const checkOutAt =
    form.checkOutDate && form.checkOutTime ? `${form.checkOutDate}T${form.checkOutTime}` : null;
  if (!checkInAt || !checkOutAt) return 'Needs both check-in and check-out times.';
  stay.checkInAt = checkInAt;
  stay.checkOutAt = checkOutAt;
  if (stay.lodging) stay.lodging.name = form.lodgingName.trim() || stay.lodging.name;
  stay.booking = readBookingFormValue(form.booking, stay.booking);
  return null;
}

// ---------- Transit ----------

export interface TransitFormState {
  fromLabel: string;
  toLabel: string;
  departsDate: string | null;
  departsTime: string | null;
  arrivesDate: string | null;
  arrivesTime: string | null;
  routeId: string | null;
  routeVariant: string | null;
  booking: BookingFormValue;
}

export function transitFormFrom(transit: Transit): TransitFormState {
  return {
    fromLabel: transit.from.label,
    toLabel: transit.to.label,
    departsDate: transit.departsAt.slice(0, 10),
    departsTime: transit.departsAt.slice(11, 16),
    arrivesDate: transit.arrivesAt ? transit.arrivesAt.slice(0, 10) : null,
    arrivesTime: transit.arrivesAt ? transit.arrivesAt.slice(11, 16) : null,
    routeId: transit.routeId,
    routeVariant: transit.routeVariant,
    booking: bookingFormValueFrom(transit.booking),
  };
}

// A routed Transit's Arrives is never authored — it's walked live from
// Departs plus the selected route variant's own drive times, so the field
// simply stays null in the data rather than carrying a guess nothing ever
// reads. Only a Transit with no route picked still needs a real one.
export function applyTransitForm(transit: Transit, form: TransitFormState): string | null {
  const departsAt =
    form.departsDate && form.departsTime ? `${form.departsDate}T${form.departsTime}` : null;
  const arrivesAt = form.routeId
    ? null
    : form.arrivesDate && form.arrivesTime
      ? `${form.arrivesDate}T${form.arrivesTime}`
      : null;
  if (!departsAt || (!form.routeId && !arrivesAt))
    return 'Needs both a departure and arrival time.';
  transit.departsAt = departsAt;
  transit.arrivesAt = arrivesAt;
  transit.from.label = form.fromLabel.trim() || transit.from.label;
  transit.to.label = form.toLabel.trim() || transit.to.label;
  transit.routeId = form.routeId;
  transit.routeVariant = form.routeId ? form.routeVariant : null;
  transit.booking = readBookingFormValue(form.booking, transit.booking);
  return null;
}

// ---------- Route ----------
//
// Route (routes.json) is reference data, not a day-list line item — a
// Transit only ever *points at* one via routeId/routeVariant (see above).
// Its own shape (from/to plus an ordered variants[]/places[] tree) is
// already exactly what a form needs, so the form state is just a working
// clone of the Route itself rather than a parallel FormState shape.

export function routeFormFrom(route: Route): Route {
  return structuredClone(route);
}

// Mirrors docs/js/edit.js's own applyRouteEdit validation: every place entry
// needs a real place and a non-negative duration, every variant needs a
// label and a non-negative final leg, and a route needs at least one
// variant — a Transit pointing at this route always needs a real one to
// select.
export function applyRouteForm(route: Route, form: Route): string | null {
  const fromLabel = form.from.label.trim();
  const toLabel = form.to.label.trim();
  if (!fromLabel || !toLabel) return 'Needs both a From and To label.';
  if (!form.variants.length) return 'Needs at least one variant.';
  for (const variant of form.variants) {
    if (!variant.label.trim()) return 'Every variant needs a label.';
    for (const place of variant.places) {
      if (!place.place?.label) return 'Every place entry needs a place name.';
      if (!place.place?.id) return 'Every place entry needs a Google Place ID.';
      if (!Number.isFinite(place.durationMinutes) || place.durationMinutes < 0) {
        return 'Every place entry needs a duration of zero or more minutes.';
      }
    }
    if (!Number.isFinite(variant.finalLegMinutes) || variant.finalLegMinutes < 0) {
      return 'Every variant needs a final-leg duration of zero or more minutes.';
    }
  }
  route.from = { ...form.from, label: fromLabel };
  route.to = { ...form.to, label: toLabel };
  route.variants = form.variants;
  return null;
}

// ---------- Trip (the trips list's own Add/Edit trip dialog) ----------
//
// Trip carries no startDate/endDate of its own — tripModel.ts's
// tripDateRange computes the trip's span from its own Legs instead, so
// there's nothing date-related for this form to own. applyTripForm covers
// both create and edit: pass the existing Trip as `base` to update it in
// place (preserving its _id/travelers/images), or null to build a fresh one.

export interface TripFormState {
  name: string;
  slug: string;
  summary: string;
}

export function blankTripForm(): TripFormState {
  return { name: '', slug: '', summary: '' };
}

export function tripFormFrom(trip: Trip, slug: string): TripFormState {
  return { name: trip.name, slug, summary: trip.summary ?? '' };
}

export function applyTripForm(
  base: Trip | null,
  form: TripFormState,
  existingSlugs: string[],
): { slug: string; trip: Trip } | string {
  const name = form.name.trim();
  if (!name) return 'Needs a name.';
  const slug = form.slug.trim();
  if (!slug) return 'Needs a slug.';
  if (existingSlugs.includes(slug)) return 'That slug is already used by another trip.';
  const trip: Trip = {
    _id: base?._id ?? crypto.randomUUID(),
    name,
    summary: form.summary.trim() || null,
    travelers: base?.travelers ?? [],
    images: base?.images ?? [],
  };
  return { slug, trip };
}

// ---------- Leg (Overview's own "Add leg" dialog) ----------
//
// A brand-new trip starts with zero Legs, and buildTripView only produces a
// Day for dates that fall inside one (see buildDay in tripModel.ts) — so
// until a first Leg exists, there's nothing for the day list's own "Add to
// this day" button to attach to, and no computed trip date range either
// (tripModel.ts's tripDateRange). Mirrors applyTripForm's shape: builds and
// returns a finished Leg rather than mutating one in place, since Add leg
// (like Add trip) only ever creates, never edits an existing Leg.
//
// No startDate/endDate/status here either — a Leg's own span is computed
// from whatever Stay/Transit/Activity ends up pointing at it (tripModel.ts's
// legDateRange), so a freshly created Leg simply has no span (and shows up
// with none) until its first entity is added.

export interface LegFormState {
  name: string;
  skeletonAuthority: Leg['skeletonAuthority'];
}

export function blankLegForm(): LegFormState {
  return { name: '', skeletonAuthority: 'self' };
}

export function applyLegForm(form: LegFormState, tripId: string): { leg: Leg } | string {
  const name = form.name.trim();
  if (!name) return 'Needs a name.';
  const leg: Leg = {
    _id: crypto.randomUUID(),
    tripId,
    name,
    skeletonAuthority: form.skeletonAuthority,
    booking: null,
    images: [],
  };
  return { leg };
}

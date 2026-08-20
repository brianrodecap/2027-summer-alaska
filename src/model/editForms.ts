// Form-state shapes and pure apply functions for the edit dialog — a direct
// port of edit.js's per-kind read/apply logic, adapted to read a plain form
// object instead of a DOM formEl. Each applyXyzEdit function mutates the
// entity passed in (the caller passes a clone — see EditContext) and
// returns null on success or a message to show inline, exactly like the
// original.
import { bookingFormValueFrom, readBookingFormValue, type BookingFormValue } from '../components/edit/BookingFields';
import type {
  Activity,
  DiningFormat,
  MealOption,
  MealType,
  Place,
  PlanStatus,
  Priority,
  Route,
  Stay,
  TimeLabel,
  Transit,
} from './types';

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
  const startAt = form.startsDate && form.startsTime ? `${form.startsDate}T${form.startsTime}` : null;
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
  const checkInAt = form.checkInDate && form.checkInTime ? `${form.checkInDate}T${form.checkInTime}` : null;
  const checkOutAt = form.checkOutDate && form.checkOutTime ? `${form.checkOutDate}T${form.checkOutTime}` : null;
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
  const departsAt = form.departsDate && form.departsTime ? `${form.departsDate}T${form.departsTime}` : null;
  const arrivesAt = form.routeId ? null : form.arrivesDate && form.arrivesTime ? `${form.arrivesDate}T${form.arrivesTime}` : null;
  if (!departsAt || (!form.routeId && !arrivesAt)) return 'Needs both a departure and arrival time.';
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

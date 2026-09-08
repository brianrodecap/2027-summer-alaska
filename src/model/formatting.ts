// Small pure formatting/vocabulary helpers reused across leg cards, the day
// list, activity rows, and the activity detail side sheet — nothing here is
// scoped to just one of those surfaces (see docs/data-model.html for the
// entity shapes these draw on).
import { activityTimeLabel } from './tripModel';
import type { DiningFormat, Image, Leg, Lodging, MealOption, MealType } from './types';
import type { PlaceSunriseSunset } from './weather';

// ---------- leg skeleton-authority vocabulary ----------

export const AUTHORITY_OPTIONS: {
  value: Leg['skeletonAuthority'];
  label: string;
  helper: string;
}[] = [
  {
    value: 'self',
    label: 'Self-planned',
    helper: 'You picked these dates/locations — free to shift them later.',
  },
  {
    value: 'operator',
    label: 'Operator-fixed',
    helper: 'An operator (cruise, tour) locked this date/location skeleton in.',
  },
];

// ---------- images: every entity carries images: Image[] — a list rather
// than one field so a hand-sourced reference photo and later personal trip
// photos can coexist. Rendering only ever draws the first entry. ----------
export function firstImage(entity: { images?: Image[] | null } | null | undefined): Image | null {
  return entity?.images?.[0] ?? null;
}

// Makes `image` the entity's own hero — firstImage's first entry — moving
// it there if it's already stored, prepending it otherwise. This is the
// *entity's* own top-level `images` (Activity/Stay/Transit), not a Place's —
// firstImage always checks that array before ever falling back to a place's
// own images (see ActivityDetailPanel et al.), so a manual "make this the
// hero" click has to land there to actually change what's shown, regardless
// of which specific place (or, for a meal, which candidate) the photo came
// from.
export function withHeroImage(images: Image[] | null | undefined, image: Image): Image[] {
  return [image, ...(images ?? []).filter((img) => img.uri !== image.uri)];
}

// The room/campsite/bed-configuration bits a Stay's lodging can carry —
// shared by the day-list's own inline StayNode and the StayDetailPanel side
// sheet, which both show the same "whatever's filled in" summary.
export function stayDetailBits(lodging: Lodging | null | undefined): string[] {
  return [
    lodging?.roomType,
    lodging?.roomNumber && `Room/cabin ${lodging.roomNumber}`,
    lodging?.campsite,
    lodging?.bedConfiguration,
  ].filter((bit): bit is string => Boolean(bit));
}

// ---------- dining-format / meal-slot vocabulary ----------

export const DINING_FORMAT_LABEL: Record<DiningFormat, string> = {
  included: 'Included',
  package: 'Package',
  'included-with-activity': 'Included with activity',
  'included-with-transit': 'Included with travel',
  'sit-down': 'Sit-down',
  'grab-and-go': 'Grab-and-go',
  drivethru: 'Drive-thru',
  'self-catered': 'Self-catered',
};

const MEAL_TYPE_LABEL: Record<MealType, string> = {
  breakfast: 'Breakfast',
  lunch: 'Lunch',
  dinner: 'Dinner',
  snack: 'Snack',
};

// A meal's booking is called a reservation; everything else's is a booking.
// One rule, one place — this previously sat inline at five call sites (the
// two edit forms, the wizard's booking step and its review row, and
// MealOptionList's per-candidate fields) in three different shapes.
export interface BookingNoun {
  noun: 'booking' | 'reservation';
  // Sentence-case for a field label ("Reservation status").
  label: string;
  // Past participle for a review row's value ("Reserved").
  done: string;
}

const MEAL_BOOKING_NOUN: BookingNoun = {
  noun: 'reservation',
  label: 'Reservation',
  done: 'Reserved',
};
const DEFAULT_BOOKING_NOUN: BookingNoun = { noun: 'booking', label: 'Booking', done: 'Booked' };

export function bookingNoun(isMeal: boolean): BookingNoun {
  return isMeal ? MEAL_BOOKING_NOUN : DEFAULT_BOOKING_NOUN;
}

// An Activity timed only as 'Sunrise'/'Sunset' (no real startAt) — the one
// case useSunAnchoredTime resolves a real clock time for. Shared by that
// hook and by ActivityRow/MealRow's own overline text so all three agree on
// exactly which Activities count as sun-anchored.
export function isSunAnchoredActivity(activity: {
  startAt: string | null;
  timeLabel: string | null;
}): boolean {
  return !activity.startAt && (activity.timeLabel === 'Sunrise' || activity.timeLabel === 'Sunset');
}

// A sun-anchored ('Sunrise'/'Sunset' timeLabel, no startAt) Activity's
// overline otherwise just shows the bare label text (activityTimeLabel's
// fallback) — this folds in the real computed clock time once
// useSunAnchoredTime resolves one, without discarding the label itself:
// "Sunrise" is still the meaningful fact (this is tied to the event, not a
// fixed hour someone picked), the clock time is precision layered on top of
// it. Falls back to the bare label when nothing's resolved yet (still
// loading, no place to compute from, API key unconfigured) so this is
// always safe to call.
export function sunAnchoredTimeLabel(
  timeLabel: string,
  resolved: PlaceSunriseSunset | null,
): string {
  const time = timeLabel === 'Sunrise' ? resolved?.sunrise : resolved?.sunset;
  return time ? `${timeLabel} (${time})` : timeLabel;
}

// Every day-list row leads with "time · type" on its overline — mealType for
// a meal Activity, 'Activity' for a plain one — matching Depart/Via/Waypoint/
// Arrive's own time-plus-type overline and Stay's relation-only one.
// timeOverride lets a caller substitute a more specific computed time in
// place of activityTimeLabel's own fallback text — MealRow's selected
// MealOption candidate span (mealOptionTimeLabel, in mealOptions.ts), or
// ActivityRow/MealRow's own sunAnchoredTimeLabel above for a Sunrise/Sunset
// Activity once its real clock time has resolved.
export function timeAndMealTypeLabel(
  activity: {
    _id: string;
    startAt: string | null;
    durationMinutes: number | null;
    timeLabel: string | null;
    mealType: MealType | null;
    diningFormat: DiningFormat | null;
    options: MealOption[] | null;
  },
  timeOverride?: string,
): string {
  const time = timeOverride ?? activityTimeLabel(activity);
  return `${time} · ${activity.mealType ? MEAL_TYPE_LABEL[activity.mealType] : 'Activity'}`;
}

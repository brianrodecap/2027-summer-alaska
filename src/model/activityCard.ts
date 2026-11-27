import { cardTravelers } from './cardTravelers';
import { bookingClockNote } from './dayClocks';
import { DINING_FORMAT_LABEL, hasPlaceInfo } from './formatting';
import { bookingHolder, includedInLabel, includedInOf } from './mealOptions';
import { activityZone } from './tripModel';
import type {
  Booking,
  EnrichedActivity,
  EnrichedMealOption,
  Note,
  Package,
  TripData,
} from './types';

// What an activity's card, or a meal's with its selected candidate, can add when it
// opens: the one rule for what it shows, and so for whether it opens at all.

export interface ActivityCardInput {
  data: Pick<TripData, 'stays' | 'transits' | 'activities'> | null;
  activity: EnrichedActivity;
  // A meal's selected candidate.
  option?: EnrichedMealOption;
  // The card's title, which no added line repeats.
  title: string;
  // The card's candidate chips already say each candidate's kind of meal.
  formatShown?: boolean;
}

// The row details under the title.
export function activityCardLines({
  data,
  activity,
  option,
  title,
  formatShown,
}: ActivityCardInput): { namedPlace: string | null; mealLine: string | null } {
  const place = option ? option.place : activity.place;
  // The card is titled by the activity's own text when it has some; the place it
  // happens at is then named too.
  const namedPlace = !option && place && place.label !== title ? place.label : null;
  const includedIn = data ? includedInLabel(data, includedInOf(activity, option)) : null;
  // A candidate with a place is named by it, so say what kind of meal it is.
  const dining = option?.place && !formatShown ? DINING_FORMAT_LABEL[option.diningFormat] : null;
  const mealLine = includedIn ?? dining;
  return { namedPlace, mealLine: mealLine === title ? null : mealLine };
}

// Whether opening the card shows anything a closed one doesn't. `notes` are all the
// open card's; a closed one already shows the warnings.
export function activityCardAdds(
  input: ActivityCardInput & {
    notes: Note[];
    names: ReadonlyMap<string, string>;
  },
): boolean {
  const { activity, option, notes, names } = input;
  const place = option ? option.place : activity.place;
  const { namedPlace, mealLine } = activityCardLines(input);
  const holder = bookingHolder<{ booking: Booking | null }>(activity, option);
  const packages: Package[] | null | undefined = activity.packages;
  return Boolean(
    namedPlace ||
    mealLine ||
    (place && hasPlaceInfo(place)) ||
    holder.booking ||
    packages?.length ||
    cardTravelers({ going: option ? option.travelers : activity.travelers, names }) ||
    // the line saying the booking's clock differs from the place's
    (activity.startAt &&
      bookingClockNote(activity.startAt, activityZone(activity), place?.timeZone)) ||
    notes.some((note) => note.kind !== 'warning'),
  );
}

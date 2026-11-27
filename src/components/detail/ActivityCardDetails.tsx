import { activityCardLines } from '../../model/activityCard';
import { cardTravelers } from '../../model/cardTravelers';
import { hasPlaceInfo } from '../../model/formatting';
import { bookingHolder } from '../../model/mealOptions';
import { activityZone, resolveActivityDate } from '../../model/tripModel';
import type { Booking, EnrichedActivity, EnrichedMealOption, Place } from '../../model/types';
import { useHeroImageSelect } from '../../state/useHeroImageSelect';
import { useActivityPlaceImagePersist } from '../../state/usePlaceImagePersist';
import { useTravelerNames } from '../../state/useTravelerNames';
import { useTripData } from '../../state/useTripData';
import { BookingClockNote } from '../day/BookingClockNote';
import { BookingDetails } from '../shared/BookingDetails';
import { CardLine, GoogleBox, TravelerList } from './CardParts';
import { PackagesSection } from './DetailSections';
import { PlacePanel } from './PlacePanel';

// What an activity's card, or a meal's with its selected candidate, adds when it
// opens.

interface Props {
  activity: EnrichedActivity;
  // A meal's selected candidate.
  option?: EnrichedMealOption;
}

const placeOf = ({ activity, option }: Props): Place | null =>
  option ? option.place : activity.place;

export function ActivityLines(props: Props & { title: string; formatShown?: boolean }) {
  const { activity } = props;
  const { data } = useTripData();
  const place = placeOf(props);
  const { namedPlace, mealLine } = activityCardLines({ ...props, data });
  return (
    <>
      <BookingClockNote
        at={activity.startAt}
        bookingZone={activityZone(activity)}
        placeZone={place?.timeZone}
      />
      {namedPlace && <CardLine>{namedPlace}</CardLine>}
      {mealLine && <CardLine quiet>{mealLine}</CardLine>}
    </>
  );
}

export function ActivityExtras({ activity, option }: Props) {
  const names = useTravelerNames();
  const holder = bookingHolder<{ _id: string; booking: Booking | null }>(activity, option);
  const date = resolveActivityDate(activity);
  return (
    <>
      <TravelerList
        travelers={cardTravelers({
          going: option ? option.travelers : activity.travelers,
          names,
        })}
      />
      {holder.booking && (
        <BookingDetails booking={holder.booking} date={date} entityId={holder._id} />
      )}
      <PackagesSection packages={activity.packages} date={date} />
    </>
  );
}

function ActivityPlace({ activity, option, place }: Props & { place: Place }) {
  const onSelectImage = useHeroImageSelect('activity', activity._id);
  const onAutoImage = useActivityPlaceImagePersist(activity, option);
  return (
    <GoogleBox fromGoogle={Boolean(place.id)}>
      <PlacePanel place={place} onSelectImage={onSelectImage} onAutoImage={onAutoImage} />
    </GoogleBox>
  );
}

export function ActivityGoogle(props: Props) {
  const place = placeOf(props);
  return place && hasPlaceInfo(place) ? <ActivityPlace {...props} place={place} /> : null;
}

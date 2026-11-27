import { stayWhenLabel } from '../../model/entityDetails';
import { dotted, hasPlaceInfo, lodgingBits, placeFromLodging } from '../../model/formatting';
import { dateOnly, stayNights, stayZone } from '../../model/tripModel';
import type { EnrichedStay, Place } from '../../model/types';
import { useHeroImageSelect } from '../../state/useHeroImageSelect';
import { useStayPlaceImagePersist } from '../../state/usePlaceImagePersist';
import { BookingClockNote } from '../day/BookingClockNote';
import { BookingDetails } from '../shared/BookingDetails';
import { CardLine, GoogleBox } from './CardParts';
import { PackagesSection, PortCallsSection } from './DetailSections';
import { PlacePanel } from './PlacePanel';

// What a stay's card adds when it opens.

export function StayLines({ stay }: { stay: EnrichedStay }) {
  const place = placeFromLodging(stay.lodging);
  const bits = dotted(lodgingBits(stay.lodging));
  return (
    <>
      <CardLine>{stayWhenLabel(stay)}</CardLine>
      <BookingClockNote
        at={stay.checkInAt}
        bookingZone={stayZone(stay)}
        placeZone={place?.timeZone}
        label="Check-in"
      />
      <BookingClockNote
        at={stay.checkOutAt}
        bookingZone={stayZone(stay)}
        placeZone={place?.timeZone}
        label="Check-out"
      />
      {bits && <CardLine quiet>{bits}</CardLine>}
    </>
  );
}

export function StayExtras({ stay }: { stay: EnrichedStay }) {
  const date = dateOnly(stay.checkInAt);
  return (
    <>
      {stay.booking && <BookingDetails booking={stay.booking} date={date} entityId={stay._id} />}
      <PackagesSection packages={stay.packages} nights={stayNights(stay)} date={date} />
      <PortCallsSection calls={stay.portCalls} />
    </>
  );
}

function StayPlace({ stay, place }: { stay: EnrichedStay; place: Place }) {
  const onSelectImage = useHeroImageSelect('stay', stay._id);
  const onAutoImage = useStayPlaceImagePersist(stay);
  return (
    <GoogleBox fromGoogle={Boolean(place.id)}>
      <PlacePanel place={place} onSelectImage={onSelectImage} onAutoImage={onAutoImage} />
    </GoogleBox>
  );
}

export function StayGoogle({ stay }: { stay: EnrichedStay }) {
  const place = placeFromLodging(stay.lodging);
  return place && hasPlaceInfo(place) ? <StayPlace stay={stay} place={place} /> : null;
}

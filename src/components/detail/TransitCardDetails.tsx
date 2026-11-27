import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { cardTravelers, travelerName } from '../../model/cardTravelers';
import { transitWhenLabel } from '../../model/entityDetails';
import { dotted } from '../../model/formatting';
import { dateOnly } from '../../model/tripModel';
import type { EnrichedTransit } from '../../model/types';
import { useHeroImageSelect } from '../../state/useHeroImageSelect';
import { useTransitPlaceImagePersist } from '../../state/usePlaceImagePersist';
import { useTravelerNames } from '../../state/useTravelerNames';
import { BookingDetails } from '../shared/BookingDetails';
import { CardLine, GoogleBox, TravelerList } from './CardParts';
import { PackagesSection, RouteNotesSection } from './DetailSections';
import { FlightStatusSection } from './FlightStatusSection';
import { PlacePanel } from './PlacePanel';

// What a transit's Depart card adds when it opens.

export function TransitLines({ transit }: { transit: EnrichedTransit }) {
  // "AS 273 · Alaska Airlines · operated by Horizon Air · Boeing 737-800",
  // leaving out whatever isn't recorded, and a carrier that an end already names (a
  // flying service's own dock).
  const ends = [transit.from.label, transit.to.label];
  const flight = dotted([
    transit.flightNumber,
    transit.carrier && !ends.includes(transit.carrier) && transit.carrier,
    transit.operatedBy && `operated by ${transit.operatedBy}`,
    transit.aircraft,
  ]);
  return (
    <>
      {/* the card is titled by where it leaves from */}
      <CardLine>
        {transit.to.label === transit.from.label ? 'Round trip' : `To ${transit.to.label}`}
      </CardLine>
      <CardLine>{transitWhenLabel(transit)}</CardLine>
      {flight && <CardLine quiet>{flight}</CardLine>}
      <FlightStatusSection transit={transit} />
    </>
  );
}

export function TransitExtras({ transit }: { transit: EnrichedTransit }) {
  const names = useTravelerNames();
  const date = dateOnly(transit.departsAt);
  return (
    <>
      <TravelerList
        travelers={cardTravelers({
          going: transit.travelers?.map((id) => travelerName(names, id)),
          seats: transit.seats,
          names,
        })}
      />
      {transit.booking && (
        <BookingDetails booking={transit.booking} date={date} entityId={transit._id} />
      )}
      <PackagesSection packages={transit.packages} date={date} />
      <RouteNotesSection routeInfo={transit.routeInfo} />
    </>
  );
}

export function TransitGoogle({ transit }: { transit: EnrichedTransit }) {
  // Both ends share one hero image, so it doesn't matter which one a click came from.
  const onSelectImage = useHeroImageSelect('transit', transit._id);
  const onAutoImageFrom = useTransitPlaceImagePersist(transit, 'from');
  const onAutoImageTo = useTransitPlaceImagePersist(transit, 'to');
  const ends = [
    { place: transit.from, onAutoImage: onAutoImageFrom },
    { place: transit.to, onAutoImage: onAutoImageTo },
  ]
    .filter(({ place }) => place.id)
    // a drive that ends where it starts shows the place once
    .filter(({ place }, i, all) => all.findIndex((end) => end.place.id === place.id) === i);
  if (!ends.length) return null;
  return (
    <GoogleBox fromGoogle>
      {ends.map(({ place, onAutoImage }) => (
        <Box key={place.id}>
          <Typography variant="subtitle2" sx={{ mt: 1 }}>
            {place.label}
          </Typography>
          <PlacePanel place={place} onSelectImage={onSelectImage} onAutoImage={onAutoImage} />
        </Box>
      ))}
    </GoogleBox>
  );
}

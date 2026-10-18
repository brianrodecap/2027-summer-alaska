import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { transitWhenLabel } from '../../model/entityDetails';
import { firstImage } from '../../model/formatting';
import { dateOnly, sheetNotes, transitRouteLabel } from '../../model/tripModel';
import type { EnrichedTransit } from '../../model/types';
import { useHeroImageSelect } from '../../state/useHeroImageSelect';
import { useTransitPlaceImagePersist } from '../../state/usePlaceImagePersist';
import { useTravelerNames } from '../../state/useTravelerNames';
import { BookingSection } from '../shared/BookingChip';
import { DetailSideSheet } from '../shared/DetailSideSheet';
import { EntityHeroImage } from '../shared/EntityHeroImage';
import { renderMaterialIcon, transitModeIconName } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';
import { PackagesSection, RouteStopsSection, TravelersSection } from './DetailSections';
import { PlacePanel } from './PlacePanel';
import { SeatList } from './SeatList';

// "AS 273 · Alaska Airlines · operated by Horizon Air · Boeing 737-800",
// leaving out whatever isn't recorded.
function flightLine(transit: EnrichedTransit): string | null {
  const parts = [
    transit.flightNumber,
    transit.carrier,
    transit.operatedBy && `operated by ${transit.operatedBy}`,
    transit.aircraft,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

// A Transit row's own tap target, opened from its Depart row — mirrors
// ActivityDetailPanel/StayDetailPanel's side sheet. A Transit's notes are
// always attached at Depart (never Arrive — see tripModel.ts's
// notesForEntity note), so this is the one place they surface for a Transit
// besides the row itself.
export function TransitDetailPanel({
  transit,
  open,
  onClose,
  onEdit,
}: {
  transit: EnrichedTransit | null;
  open: boolean;
  onClose: () => void;
  onEdit?: () => void;
}) {
  // Both endpoints share one hero image, so this doesn't need to know which
  // one a click came from.
  const onSelectImage = useHeroImageSelect('transit', transit?._id);
  const onAutoImageFrom = useTransitPlaceImagePersist(transit, 'from');
  const onAutoImageTo = useTransitPlaceImagePersist(transit, 'to');
  const names = useTravelerNames();

  if (!transit) return null;
  const flight = flightLine(transit);

  const image = firstImage(transit, transit.from, transit.to);
  const endpoints = [
    { place: transit.from, onAutoImage: onAutoImageFrom },
    { place: transit.to, onAutoImage: onAutoImageTo },
  ];

  return (
    <DetailSideSheet
      open={open}
      onClose={onClose}
      onEdit={onEdit}
      title={transitRouteLabel(transit)}
      titleIcon={renderMaterialIcon(transitModeIconName(transit), { color: 'primary' })}
    >
      <EntityHeroImage image={image} />
      <Typography variant="body1">{transitWhenLabel(transit)}</Typography>
      {flight && (
        <Typography variant="body2" color="text.secondary">
          {flight}
        </Typography>
      )}
      <BookingSection
        booking={transit.booking}
        date={dateOnly(transit.departsAt)}
        entityId={transit._id}
      />
      <SeatList transit={transit} />
      <TravelersSection
        names={transit.travelers?.map((id) => names.get(id) ?? id) ?? null}
        wholePartyWhenNull
      />
      <RouteStopsSection routeInfo={transit.routeInfo} />
      <NotesCluster notes={sheetNotes(transit)} expanded />
      <PackagesSection packages={transit.packages} date={dateOnly(transit.departsAt)} />
      {endpoints.map(
        ({ place, onAutoImage }) =>
          place.id && (
            <Stack key={place.id} spacing={0.5}>
              <Typography variant="overline" color="text.secondary">
                {place.label}
              </Typography>
              <PlacePanel place={place} onSelectImage={onSelectImage} onAutoImage={onAutoImage} />
            </Stack>
          ),
      )}
    </DetailSideSheet>
  );
}

import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useMemo } from 'react';

import { bookingCoverageLabels } from '../../model/editForms';
import { firstImage } from '../../model/formatting';
import { formatTime, transitRouteLabel, travelersById } from '../../model/tripModel';
import type { EnrichedTransit, Traveler } from '../../model/types';
import { useHeroImageSelect } from '../../state/useHeroImageSelect';
import { useTransitPlaceImagePersist } from '../../state/usePlaceImagePersist';
import { useTripData } from '../../state/useTripData';
import { BookingSection } from '../shared/BookingChip';
import { DetailSideSheet } from '../shared/DetailSideSheet';
import { EntityHeroImage } from '../shared/EntityHeroImage';
import { renderMaterialIcon, transitModeIconName } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';
import { PlacePanel } from './PlacePanel';

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

// One line per seated traveler on this Transit: "Brian Rodecap — 22A · Coach (N)".
function SeatList({ transit, travelers }: { transit: EnrichedTransit; travelers: Traveler[] }) {
  if (!transit.seats?.length) return null;
  const names = travelersById(travelers);
  return (
    <Stack spacing={0.25}>
      <Typography variant="overline" color="text.secondary">
        Seats
      </Typography>
      <Box component="ul" sx={{ pl: 2, m: 0 }}>
        {transit.seats.map((s) => (
          <Typography component="li" variant="body2" key={s.travelerId}>
            {names.get(s.travelerId) ?? s.travelerId} — {s.seat}
            {s.cabin ? ` · ${s.cabin}` : ''}
            {s.fareClass ? ` (${s.fareClass})` : ''}
          </Typography>
        ))}
      </Box>
    </Stack>
  );
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
  const { data } = useTripData();
  // The other entries this same booking covers — a round trip's other flight.
  const bookingId = transit?.bookingId;
  const transitId = transit?._id;
  const alsoCovers = useMemo(
    () => (data && bookingId && transitId ? bookingCoverageLabels(data, bookingId, transitId) : []),
    [data, bookingId, transitId],
  );

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
      <Typography variant="body1">
        {formatTime(transit.departsAt)} depart ·{' '}
        {transit.arrivesAt ? `${formatTime(transit.arrivesAt)} arrive` : 'arrival time TBD'}
      </Typography>
      {flight && (
        <Typography variant="body2" color="text.secondary">
          {flight}
        </Typography>
      )}
      <BookingSection booking={transit.booking} />
      {alsoCovers.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          Same booking also covers {alsoCovers.join(', ')}.
        </Typography>
      )}
      {data && <SeatList transit={transit} travelers={data.trip.travelers} />}
      <NotesCluster notes={transit.notes} expanded />
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

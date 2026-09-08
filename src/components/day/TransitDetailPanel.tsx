import Box from '@mui/material/Box';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { firstImage } from '../../model/formatting';
import { formatTime, transitRouteLabel } from '../../model/tripModel';
import type { EnrichedTransit } from '../../model/types';
import { useHeroImageSelect } from '../../state/useHeroImageSelect';
import { PlacePanel } from '../activity/PlacePanel';
import { BookingChip } from '../shared/BookingChip';
import { DetailSideSheet } from '../shared/DetailSideSheet';
import { EntityHeroImage } from '../shared/EntityHeroImage';
import { renderMaterialIcon } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';

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

  if (!transit) return null;

  const image = firstImage(transit);

  return (
    <DetailSideSheet
      open={open}
      onClose={onClose}
      onEdit={onEdit}
      title={transitRouteLabel(transit)}
      titleIcon={renderMaterialIcon(transit.mode === 'flight' ? 'flight' : 'directions_car', {
        color: 'primary',
      })}
    >
      <EntityHeroImage image={image} />
      <Typography variant="body1">
        {formatTime(transit.departsAt)} depart ·{' '}
        {transit.arrivesAt ? `${formatTime(transit.arrivesAt)} arrive` : 'arrival time TBD'}
      </Typography>
      {transit.booking && (
        <Box sx={{ mt: 1.5 }}>
          <BookingChip booking={transit.booking} />
        </Box>
      )}
      <NotesCluster notes={transit.notes} expanded />
      {[transit.from, transit.to].map(
        (endpoint) =>
          endpoint.id && (
            <Stack key={endpoint.id} spacing={0.5}>
              <Typography variant="overline" color="text.secondary">
                {endpoint.label}
              </Typography>
              <PlacePanel place={endpoint} onSelectImage={onSelectImage} />
            </Stack>
          ),
      )}
    </DetailSideSheet>
  );
}

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { formatTime } from '../../model/tripModel';
import { firstImage } from '../../model/formatting';
import { materialIcon } from '../shared/materialIcon';
import { DetailSideSheet } from '../shared/DetailSideSheet';
import { BookingChip } from '../shared/BookingChip';
import { NotesCluster } from '../shared/Notes';
import type { EnrichedTransit } from '../../model/types';

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
  if (!transit) return null;

  const image = firstImage(transit);
  const Icon = materialIcon(transit.mode === 'flight' ? 'flight' : 'directions_car');

  return (
    <DetailSideSheet
      open={open}
      onClose={onClose}
      onEdit={onEdit}
      title={`${transit.from.label} → ${transit.to.label}`}
      titleIcon={<Icon color="primary" />}
    >
      {image && (
        <Box component="img" src={image.uri} alt={image.caption ?? ''} title={image.credit ?? ''} sx={{ width: '100%', borderRadius: 2, mb: 2 }} />
      )}
      <Typography variant="body1">
        {formatTime(transit.departsAt)} depart · {transit.arrivesAt ? `${formatTime(transit.arrivesAt)} arrive` : 'arrival time TBD'}
      </Typography>
      {transit.booking && (
        <Box sx={{ mt: 1.5 }}>
          <BookingChip booking={transit.booking} />
        </Box>
      )}
      <NotesCluster notes={transit.notes} expanded />
    </DetailSideSheet>
  );
}

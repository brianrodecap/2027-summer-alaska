import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { firstImage } from '../../model/formatting';
import { formatTime } from '../../model/tripModel';
import type { EnrichedStay } from '../../model/types';
import { BookingChip } from '../shared/BookingChip';
import { DetailSideSheet } from '../shared/DetailSideSheet';
import { renderMaterialIcon } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';

// A Stay row's own tap target — mirrors ActivityDetailPanel's side sheet
// (title/icon, the same detail already visible inline in the timeline row,
// its own notes, and an edit entry point) so every day-list row kind opens
// the same way on tap.
export function StayDetailPanel({
  stay,
  open,
  onClose,
  onEdit,
}: {
  stay: EnrichedStay | null;
  open: boolean;
  onClose: () => void;
  onEdit?: () => void;
}) {
  if (!stay) return null;

  const image = firstImage(stay);
  const detailBits = [
    stay.lodging?.roomType,
    stay.lodging?.roomNumber && `Room/cabin ${stay.lodging.roomNumber}`,
    stay.lodging?.campsite,
    stay.lodging?.bedConfiguration,
  ].filter(Boolean) as string[];

  return (
    <DetailSideSheet
      open={open}
      onClose={onClose}
      onEdit={onEdit}
      title={stay.lodging?.name ?? 'Lodging still open'}
      titleIcon={renderMaterialIcon('hotel', { color: 'primary' })}
    >
      {image && (
        <Box
          component="img"
          src={image.uri}
          alt={image.caption ?? ''}
          title={image.credit ?? ''}
          sx={{ width: '100%', borderRadius: 2, mb: 2 }}
        />
      )}
      <Typography variant="body1">
        {formatTime(stay.checkInAt)} in · {formatTime(stay.checkOutAt)} out
      </Typography>
      {detailBits.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          {detailBits.join(' · ')}
        </Typography>
      )}
      {stay.booking && (
        <Box sx={{ mt: 1.5 }}>
          <BookingChip booking={stay.booking} />
        </Box>
      )}
      <NotesCluster notes={stay.notes} expanded />
    </DetailSideSheet>
  );
}

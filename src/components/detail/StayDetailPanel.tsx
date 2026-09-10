import Typography from '@mui/material/Typography';

import { firstImage, placeFromLodging, stayDetailBits } from '../../model/formatting';
import { formatTime } from '../../model/tripModel';
import type { EnrichedStay } from '../../model/types';
import { useHeroImageSelect } from '../../state/useHeroImageSelect';
import { useStayPlaceImagePersist } from '../../state/usePlaceImagePersist';
import { BookingSection } from '../shared/BookingChip';
import { DetailSideSheet } from '../shared/DetailSideSheet';
import { EntityHeroImage } from '../shared/EntityHeroImage';
import { renderMaterialIcon } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';
import { PlacePanel } from './PlacePanel';

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
  const onSelectImage = useHeroImageSelect('stay', stay?._id);
  const onAutoImage = useStayPlaceImagePersist(stay);

  if (!stay) return null;

  const detailBits = stayDetailBits(stay.lodging);
  const place = placeFromLodging(stay.lodging);
  const image = firstImage(stay, place);

  return (
    <DetailSideSheet
      open={open}
      onClose={onClose}
      onEdit={onEdit}
      title={place?.label ?? 'Lodging still open'}
      titleIcon={renderMaterialIcon('hotel', { color: 'primary' })}
    >
      <EntityHeroImage image={image} />
      <Typography variant="body1">
        {formatTime(stay.checkInAt)} in · {formatTime(stay.checkOutAt)} out
      </Typography>
      {detailBits.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          {detailBits.join(' · ')}
        </Typography>
      )}
      <BookingSection booking={stay.booking} />
      <NotesCluster notes={stay.notes} expanded />
      {place && (
        <PlacePanel place={place} onSelectImage={onSelectImage} onAutoImage={onAutoImage} />
      )}
    </DetailSideSheet>
  );
}

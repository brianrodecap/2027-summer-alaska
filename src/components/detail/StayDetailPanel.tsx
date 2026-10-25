import Typography from '@mui/material/Typography';

import { stayWhenLabel } from '../../model/entityDetails';
import {
  firstImage,
  lodgingExtraBits,
  placeFromLodging,
  stayDetailBits,
} from '../../model/formatting';
import { dateOnly, sheetNotes, stayNights, stayZone } from '../../model/tripModel';
import type { EnrichedStay } from '../../model/types';
import { useHeroImageSelect } from '../../state/useHeroImageSelect';
import { useStayPlaceImagePersist } from '../../state/usePlaceImagePersist';
import { BookingClockNote } from '../day/BookingClockNote';
import { BookingSection } from '../shared/BookingChip';
import { DetailSideSheet } from '../shared/DetailSideSheet';
import { EntityHeroImage } from '../shared/EntityHeroImage';
import { renderMaterialIcon } from '../shared/materialIcon';
import { NotesCluster } from '../shared/Notes';
import { PackagesSection, PortCallsSection } from './DetailSections';
import { PlacePanel } from './PlacePanel';

// A Stay row's own tap target — mirrors ActivityDetailPanel's side sheet
// (title/icon, every field the Stay records, its own notes, and an edit entry
// point) so every day-list row kind opens the same way on tap.
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

  const detailBits = [...stayDetailBits(stay.lodging), ...lodgingExtraBits(stay.lodging)];
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
      <Typography variant="body1">{stayWhenLabel(stay)}</Typography>
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
      {detailBits.length > 0 && (
        <Typography variant="body2" color="text.secondary">
          {detailBits.join(' · ')}
        </Typography>
      )}
      <BookingSection booking={stay.booking} date={dateOnly(stay.checkInAt)} entityId={stay._id} />
      <NotesCluster notes={sheetNotes(stay)} expanded />
      <PackagesSection
        packages={stay.packages}
        nights={stayNights(stay)}
        date={dateOnly(stay.checkInAt)}
      />
      <PortCallsSection calls={stay.portCalls} />
      {place && (
        <PlacePanel place={place} onSelectImage={onSelectImage} onAutoImage={onAutoImage} />
      )}
    </DetailSideSheet>
  );
}

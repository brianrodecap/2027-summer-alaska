import type { Image } from '../../model/types';
import { TripImage } from './TripImage';

// The hero image shown at the top of a detail side sheet or dialog — Stay,
// Transit, Activity, and Leg all render this identically for their own
// firstImage(entity).
export function EntityHeroImage({ image }: { image: Image | null }) {
  return <TripImage image={image} sx={{ width: '100%', borderRadius: 2, mb: 2 }} />;
}

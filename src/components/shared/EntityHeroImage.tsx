import Box from '@mui/material/Box';

import type { Image } from '../../model/types';

// The hero image shown at the top of a detail side sheet or dialog — Stay,
// Transit, Activity, and Leg all render this identically for their own
// firstImage(entity).
export function EntityHeroImage({ image }: { image: Image | null }) {
  if (!image) return null;
  return (
    <Box
      component="img"
      src={image.uri}
      alt={image.caption ?? ''}
      title={image.credit ?? ''}
      sx={{ width: '100%', borderRadius: 2, mb: 2 }}
    />
  );
}

import LandscapeIcon from '@mui/icons-material/Landscape';
import Box from '@mui/material/Box';

import type { PhotoSize } from '../../model/placePhotos';
import type { Image } from '../../model/types';
import { useInViewport } from '../day/useInViewport';
import { TripImage } from './TripImage';

// A card's photo band, `height` tall — the trip card's and the leg card's. When
// there's nothing to draw (no image, a place photo still being looked up or
// without photos, one that fails to load), the band keeps its height with a
// landscape icon on the card's own color, rather than collapsing or showing a
// blank strip. Until the card is scrolled near, the band is held empty (as an
// image still loading looks) rather than drawing the icon, so a place photo
// below the fold isn't looked up yet and a card in view doesn't flash the icon.
export function CardPhoto({
  image,
  height,
  size,
}: {
  image: Image | null;
  height: number;
  size?: PhotoSize;
}) {
  const { ref, inView } = useInViewport<HTMLElement>();
  if (!inView) return <Box ref={ref} sx={{ height }} />;
  return (
    <TripImage
      image={image}
      loading="lazy"
      size={size}
      sx={{ display: 'block', width: '100%', height, objectFit: 'cover' }}
      fallback={
        <Box
          sx={{
            height,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            bgcolor: 'primary.container',
            color: 'primary.onContainer',
          }}
        >
          <LandscapeIcon sx={{ fontSize: 48 }} />
        </Box>
      }
    />
  );
}

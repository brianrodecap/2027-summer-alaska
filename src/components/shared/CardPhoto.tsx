import LandscapeIcon from '@mui/icons-material/Landscape';
import Box from '@mui/material/Box';

import type { Image } from '../../model/types';
import { TripImage } from './TripImage';

// A card's photo band, `height` tall — the trip card's and the leg card's. When
// there's nothing to draw (no image, a place photo still being looked up or
// without photos, one that fails to load), the band keeps its height with a
// landscape icon on the card's own color, rather than collapsing or showing a
// blank strip.
export function CardPhoto({ image, height }: { image: Image | null; height: number }) {
  return (
    <TripImage
      image={image}
      loading="lazy"
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

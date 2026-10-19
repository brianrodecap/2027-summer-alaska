import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { forwardRef, type ReactNode } from 'react';

import type { PhotoSize } from '../../model/placePhotos';
import type { Image } from '../../model/types';
import { useDrawableImage } from './useResolvedImage';

// Every stored image drawn as an <img>: a web image as is, a Google place photo
// resolved live (useDrawableImage). Whenever there's nothing to draw — no
// image, a place photo still being looked up or with no photos, or an image
// that fails to load — it draws `fallback` instead (nothing by default), so no
// caller ever shows a broken image.
export const TripImage = forwardRef<
  HTMLElement,
  {
    image: Image | null;
    // False defers a place photo's lookup (see useDrawableImage).
    enabled?: boolean;
    fallback?: ReactNode;
    loading?: 'lazy' | 'eager';
    // A place photo's media size (see PHOTO_SIZE_PX); 'photo' by default.
    size?: PhotoSize;
    sx?: SxProps<Theme>;
  }
>(function TripImage({ image, enabled = true, fallback = null, loading, size, sx }, ref) {
  const { resolved, onError } = useDrawableImage(image, { enabled, size });
  if (!resolved) return <>{fallback}</>;
  return (
    <Box
      ref={ref}
      component="img"
      src={resolved.src}
      alt={image?.caption ?? ''}
      title={resolved.credit ?? undefined}
      loading={loading}
      onError={onError}
      sx={sx}
    />
  );
});

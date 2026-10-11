import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';
import { forwardRef, type ReactNode, useState } from 'react';

import type { Image } from '../../model/types';
import { useResolvedImage } from './useResolvedImage';

// Every stored image drawn as an <img>: a web image as is, a Google place photo
// resolved live (useResolvedImage). Whenever there's nothing to draw — no
// image, a place photo still being looked up or with no photos, or an image
// that fails to load — it draws `fallback` instead (nothing by default), so no
// caller ever shows a broken image.
export const TripImage = forwardRef<
  HTMLElement,
  {
    image: Image | null;
    // False defers a place photo's lookup (see useResolvedImage).
    enabled?: boolean;
    fallback?: ReactNode;
    loading?: 'lazy' | 'eager';
    sx?: SxProps<Theme>;
  }
>(function TripImage({ image, enabled = true, fallback = null, loading, sx }, ref) {
  const resolved = useResolvedImage(image, enabled);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  if (!resolved || resolved.src === failedSrc) return <>{fallback}</>;
  return (
    <Box
      ref={ref}
      component="img"
      src={resolved.src}
      alt={image?.caption ?? ''}
      title={resolved.credit ?? undefined}
      loading={loading}
      onError={() => setFailedSrc(resolved.src)}
      sx={sx}
    />
  );
});

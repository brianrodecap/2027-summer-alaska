import Box from '@mui/material/Box';
import { forwardRef } from 'react';

import { renderMaterialIcon } from './materialIcon';
import { ROW_PHOTO_SX } from './rowLeadingTokens';

// The icon box a day-list card shows when it has no photo.
//
// Ref-forwarding: a card with an image swaps this out once its useInViewport
// observer fires, so the observer attaches to whichever of the two is drawn.
export const RowLeadingDot = forwardRef<HTMLDivElement, { icon: string | null | undefined }>(
  function RowLeadingDot({ icon }, ref) {
    return (
      <Box
        ref={ref}
        sx={{
          ...ROW_PHOTO_SX,
          display: 'grid',
          placeItems: 'center',
          bgcolor: 'action.hover',
          color: 'text.secondary',
        }}
      >
        {renderMaterialIcon(icon, { fontSize: 'medium' })}
      </Box>
    );
  },
);

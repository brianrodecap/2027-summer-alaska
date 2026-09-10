import TimelineDot from '@mui/lab/TimelineDot';
import { forwardRef } from 'react';

import { renderMaterialIcon } from './materialIcon';
import { ROW_LEADING_SIZE } from './rowLeadingTokens';

// The day timeline's default leading-dot treatment (see DayTimeline.tsx,
// ActivityRow.tsx, MealRow.tsx) — an outlined dot around a small icon,
// substituted for a row's own image when it has none. TimelineDot ships a
// built-in `margin: 11.5px 0` (sized to center it against MUI's default
// TimelineOppositeContent, which this app never uses) — zeroed out here so
// it sits flush at the top of its TimelineSeparator, matching an
// Avatar-image row's own 0-margin image.
//
// Ref-forwarding: an image-bearing row swaps this dot out for an Avatar once
// its own useInViewport observer fires (see ActivityRow/MealRow/DayTimeline)
// — the same observer ref needs to attach to whichever of the two is
// currently rendered, this dot included, while it's still the placeholder.
export const RowLeadingDot = forwardRef<HTMLDivElement, { icon: string | null | undefined }>(
  function RowLeadingDot({ icon }, ref) {
    return (
      <TimelineDot
        ref={ref}
        variant="outlined"
        color="grey"
        // @mui/lab's TimelineDot root is `display: flex` with no
        // alignItems/justifyContent of its own — harmless at its default
        // unsized footprint (the icon nearly fills the padded box either
        // way) but once forced to a fixed diameter bigger than the icon,
        // flex-start left the icon stuck in the top-left corner instead of
        // centered in the circle.
        sx={{
          m: 0,
          width: ROW_LEADING_SIZE,
          height: ROW_LEADING_SIZE,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {renderMaterialIcon(icon, { fontSize: 'medium' })}
      </TimelineDot>
    );
  },
);

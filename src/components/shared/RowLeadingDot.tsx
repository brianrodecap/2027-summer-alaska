import TimelineDot from '@mui/lab/TimelineDot';

import { renderMaterialIcon } from './materialIcon';

// The day timeline's default leading-dot treatment (see DayTimeline.tsx,
// ActivityRow.tsx, MealRow.tsx) — an outlined dot around a small icon,
// substituted for a row's own image when it has none. TimelineDot ships a
// built-in `margin: 11.5px 0` (sized to center it against MUI's default
// TimelineOppositeContent, which this app never uses) — zeroed out here so
// it sits flush at the top of its TimelineSeparator, matching an
// Avatar-image row's own 0-margin image.
export function RowLeadingDot({ icon }: { icon: string | null | undefined }) {
  return (
    <TimelineDot variant="outlined" color="grey" sx={{ m: 0 }}>
      {renderMaterialIcon(icon, { fontSize: 'small' })}
    </TimelineDot>
  );
}

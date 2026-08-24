import TimelineDot from '@mui/lab/TimelineDot';

import { renderMaterialIcon } from './materialIcon';

// The day timeline's default leading-dot treatment (see DayTimeline.tsx,
// ActivityRow.tsx, MealRow.tsx) — an outlined dot around a small icon,
// substituted for a row's own image when it has none.
export function RowLeadingDot({ icon }: { icon: string | null | undefined }) {
  return (
    <TimelineDot variant="outlined" color="grey">
      {renderMaterialIcon(icon, { fontSize: 'small' })}
    </TimelineDot>
  );
}

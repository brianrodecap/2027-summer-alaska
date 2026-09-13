import Box from '@mui/material/Box';
import type { ReactNode } from 'react';

// A dumb layout shell for the day header's live-info rows — each child
// (DayTravelChip, DayWeatherChips, ...) renders its own row; this never
// imports either one's fetch logic and doesn't know what it's holding
// beyond `children`, so a row can be added, removed, or reused without
// touching any other row. The gap between rows stays bigger than either
// child's own internal wrap gap (see DayWeatherChips' rowGap), so a row
// that wraps onto a second line still reads as continuing itself rather
// than drifting into the next row.
export function DayInfoStrip({ children }: { children: ReactNode }) {
  return <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>{children}</Box>;
}

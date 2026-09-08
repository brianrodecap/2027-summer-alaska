import Chip from '@mui/material/Chip';

import { renderMaterialIcon } from '../shared/materialIcon';
import { useDayHoliday } from './useDayHoliday';
import { useInViewport } from './useInViewport';

// A small, always-visible flag for a US public holiday falling on this day —
// sits right in the sticky header next to the date/title, so it reads even
// while the day block is collapsed. Renders nothing at all while loading or
// on a non-holiday/failed lookup, same "don't draw attention to a
// nice-to-have that isn't ready" approach as DayAlertsBanner. Viewport-gated
// like DayWeatherStrip — DaysView renders every day block unvirtualized, so
// an ungated lookup would fire for all of them on mount; the wrapping <span>
// keeps a ref target in the header for useInViewport to observe even while
// nothing else here renders.
export function DayHolidayChip({ date }: { date: string }) {
  const { ref, inView } = useInViewport<HTMLSpanElement>();
  const holiday = useDayHoliday(date, inView);
  return (
    <span ref={ref}>
      {holiday && (
        <Chip
          size="small"
          icon={renderMaterialIcon('celebration')}
          label={holiday.name}
          sx={{
            ml: 1,
            bgcolor: 'secondary.container',
            color: 'secondary.onContainer',
            '& .MuiChip-icon': { color: 'secondary.onContainer' },
          }}
        />
      )}
    </span>
  );
}

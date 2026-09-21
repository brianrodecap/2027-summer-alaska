import { useCallback, useState } from 'react';

import type { Day } from '../../model/types';
import { useLiveDays } from '../../state/useLiveDays';

// The map dialog narrow screens open from a day's map icon. mapDay stays set
// while the dialog animates out (open flips first), so DayMapPanel doesn't
// unmount mid-transition — it's replaced, not cleared, by the next map icon
// click. The day handed to the panel is looked up live so it follows
// selection changes while open.
export function useDayMapDialog() {
  const { byDate } = useLiveDays();
  const [mapDay, setMapDay] = useState<Day | null>(null);
  const [open, setOpen] = useState(false);
  const openMap = useCallback((day: Day) => {
    setMapDay(day);
    setOpen(true);
  }, []);
  const close = useCallback(() => setOpen(false), []);
  const day = mapDay && (byDate.get(mapDay.date) ?? mapDay);
  return { openMap, panelProps: { day, open, onClose: close } };
}

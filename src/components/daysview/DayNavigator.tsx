import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { useEffect, useRef } from 'react';

import type { Day } from '../../model/types';
import { STICKY_PANE_SX } from '../day/dayLayout';

// The left pane of the wide layout: one line per visible day, the day the reader
// has scrolled to highlighted. Picking a day scrolls the day list to it. Full
// viewport height and sticky like the map pane, and hidden below the same `lg`
// breakpoint.
export function DayNavigator({
  days,
  activeDate,
  onSelectDay,
}: {
  days: Day[];
  activeDate: string | null;
  onSelectDay: (date: string) => void;
}) {
  const pane = useRef<HTMLElement | null>(null);

  // Keeps the highlighted day in view as the reader scrolls the day list. Moves
  // the pane's own scroll only, never the page's.
  useEffect(() => {
    const el = pane.current;
    const item = activeDate ? el?.querySelector<HTMLElement>(`[data-date="${activeDate}"]`) : null;
    if (!el || !item) return;
    const top = item.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
    if (top < el.scrollTop) {
      el.scrollTop = top;
    } else if (top + item.offsetHeight > el.scrollTop + el.clientHeight) {
      el.scrollTop = top + item.offsetHeight - el.clientHeight;
    }
  }, [activeDate]);

  return (
    <Box
      component="nav"
      aria-label="Days"
      ref={pane}
      sx={{
        ...STICKY_PANE_SX,
        display: { xs: 'none', lg: 'block' },
        width: { lg: 220, xl: 260 },
        overflowY: 'auto',
      }}
    >
      <List disablePadding>
        {days.map((day) => {
          const active = day.date === activeDate;
          return (
            <ListItemButton
              key={day.date}
              data-date={day.date}
              selected={active}
              aria-current={active ? 'date' : undefined}
              onClick={() => onSelectDay(day.date)}
              sx={{
                borderLeft: 3,
                borderColor: 'transparent',
                '&.Mui-selected': { borderColor: 'primary.main' },
              }}
            >
              <ListItemText
                primary={day.dateLabel}
                secondary={day.title}
                slotProps={{
                  primary: { variant: 'caption', color: 'text.secondary' },
                  secondary: { variant: 'body2', color: 'text.primary', noWrap: true },
                }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}

import Box from '@mui/material/Box';
import List from '@mui/material/List';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import { useEffect, useRef } from 'react';

import { dayBookingState } from '../../model/dayBookings';
import { dayKind } from '../../model/dayKind';
import { planCount, posterCaption } from '../../model/dayPoster';
import type { Booking, Day } from '../../model/types';
import { POSTER_GOLD } from '../day/art/posterColors';
import { PosterScene } from '../day/art/PosterScene';
import { SCENE_FOR_KIND } from '../day/art/sceneFor';
import { STICKY_PANE_SX } from '../day/dayLayout';

// The left pane of the wide layout: one line per visible day, the day the reader
// has scrolled to highlighted. Picking a day scrolls the day list to it. Full
// viewport height and sticky like the map pane, and hidden below the same `lg`
// breakpoint.
export function DayNavigator({
  days,
  activeDate,
  bookings,
  tripStart,
  onSelectDay,
}: {
  days: Day[];
  activeDate: string | null;
  bookings: Booking[];
  tripStart: string | null;
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
              <DayThumbnail day={day} tripStart={tripStart} />
              <ListItemText
                primary={
                  <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <span>{day.dateLabel}</span>
                    <DayMarks day={day} bookings={bookings} />
                  </Box>
                }
                secondary={day.title}
                slotProps={{
                  primary: { variant: 'caption', color: 'text.secondary' },
                  secondary: { variant: 'body2', color: 'text.primary', noWrap: true },
                }}
                sx={{ minWidth: 0, my: 0 }}
              />
            </ListItemButton>
          );
        })}
      </List>
    </Box>
  );
}

// The day's scene, small, with its day of the month in gold.
function DayThumbnail({ day, tripStart }: { day: Day; tripStart: string | null }) {
  return (
    <Box
      sx={{
        position: 'relative',
        width: 52,
        height: 40,
        flexShrink: 0,
        mr: 1.25,
        borderRadius: 1,
        overflow: 'hidden',
      }}
    >
      <PosterScene scene={SCENE_FOR_KIND[dayKind(day)]} />
      <Typography
        component="span"
        sx={{
          position: 'absolute',
          left: 4,
          bottom: 1,
          fontSize: 15,
          fontWeight: 900,
          lineHeight: 1,
          color: POSTER_GOLD,
          textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}
      >
        {posterCaption(day.date, tripStart).number}
      </Typography>
    </Box>
  );
}

// A dot for whether the day's bookings are made (green) or still to do (mustard), and
// a badge on a day with plans.
function DayMarks({ day, bookings }: { day: Day; bookings: Booking[] }) {
  const state = dayBookingState(day, bookings);
  const plans = planCount(day.scenarioTracks);
  if (!state && !plans) return null;
  return (
    <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75, ml: 'auto' }}>
      {plans > 1 && (
        <Typography
          component="span"
          sx={{
            px: 0.5,
            borderRadius: 0.5,
            bgcolor: 'warning.main',
            color: 'warning.contrastText',
            fontSize: 10,
            fontWeight: 900,
            letterSpacing: '0.06em',
          }}
        >
          {plans} plans
        </Typography>
      )}
      {state && (
        <Box
          component="span"
          role="img"
          aria-label={state === 'booked' ? 'Bookings made' : 'Bookings still to make'}
          data-testid={`day-booking-${day.date}`}
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: state === 'booked' ? 'success.main' : 'warning.main',
          }}
        />
      )}
    </Box>
  );
}

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import { dayKind } from '../../model/dayKind';
import { kindStamp, planCount, posterCaption } from '../../model/dayPoster';
import type { Day } from '../../model/types';
import { POSTER_CREAM, POSTER_GOLD } from './art/posterColors';
import { PosterScene } from './art/PosterScene';
import { SCENE_FOR_KIND } from './art/sceneFor';
import { DayTitleField } from './DayTitleField';

// A day's poster: the scene for its kind of day, the day of the month in large gold,
// "Tue · June · Day 4", the title, and a stamp naming the kind of day.
export function DayPoster({ day, tripStart }: { day: Day; tripStart: string | null }) {
  const kind = dayKind(day);
  const caption = posterCaption(day.date, tripStart);
  const stamp = kindStamp(kind, planCount(day.scenarioTracks));
  return (
    <Box
      data-testid={`day-poster-${day.date}`}
      sx={{ position: 'relative', height: 150, overflow: 'hidden', color: POSTER_CREAM }}
    >
      <Box sx={{ position: 'absolute', inset: 0 }}>
        <PosterScene scene={SCENE_FOR_KIND[kind]} />
      </Box>
      {stamp && (
        <Typography
          component="span"
          sx={{
            position: 'absolute',
            top: 12,
            right: 12,
            px: 1,
            py: 0.5,
            border: '1.5px solid currentColor',
            borderRadius: 0.5,
            bgcolor: 'rgba(20,14,6,0.35)',
            fontSize: 11,
            fontWeight: 900,
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            transform: 'rotate(-3deg)',
          }}
        >
          {stamp}
        </Typography>
      )}
      <Box
        sx={{
          position: 'absolute',
          inset: 'auto 0 0',
          display: 'flex',
          alignItems: 'flex-end',
          gap: 1.5,
          px: 2,
          pb: 1.5,
          pt: 4,
          background: 'linear-gradient(transparent, rgba(16,12,6,0.78))',
        }}
      >
        <Typography
          component="span"
          sx={{ fontSize: 62, fontWeight: 900, lineHeight: 0.82, color: POSTER_GOLD }}
        >
          {caption.number}
        </Typography>
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            component="div"
            sx={{
              fontSize: 11,
              fontWeight: 900,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
            }}
          >
            {caption.dayLine}
          </Typography>
          <DayTitleField day={day} expanded onPoster />
        </Box>
      </Box>
    </Box>
  );
}

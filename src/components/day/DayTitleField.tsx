import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { useRef, useState } from 'react';

import { titleTarget, withTitle } from '../../model/dayTitles';
import type { Day } from '../../model/types';
import { useTripData } from '../../state/useTripData';
import { materialIcon } from '../shared/materialIcon';
import { POSTER_CREAM } from './art/posterColors';

const EditIcon = materialIcon('edit');

// The day's title, with a pencil that turns it into a text field. The text saved is
// the one shown: the selected plan's title if it has one, else the date's. Blank
// text removes it, so the day goes back to its derived title.
//
// Sits inside the day accordion's clickable summary, so clicks and keys in the
// field stop here instead of expanding or collapsing the day.
// `onPoster` is for a title laid over the day poster's art, which reads in fixed light
// colors whatever the theme.
export function DayTitleField({
  day,
  expanded,
  onPoster = false,
}: {
  day: Day;
  expanded: boolean;
  onPoster?: boolean;
}) {
  const ink = onPoster ? POSTER_CREAM : 'gold.main';
  const { setData } = useTripData();
  const [text, setText] = useState<string | null>(null);
  const cancelled = useRef(false);

  const finish = () => {
    if (text === null || cancelled.current) return;
    setText(null);
    if (text.trim() !== day.title) setData((prev) => withTitle(prev, titleTarget(day), text));
  };

  if (text === null) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
        <Typography variant="h6" noWrap={!expanded} sx={{ color: ink, minWidth: 0 }}>
          {day.title}
        </Typography>
        <IconButton
          // Not a <button>: the accordion summary around it is one.
          component="span"
          size="small"
          aria-label={`Edit the title of ${day.dateLabel}`}
          onClick={(e) => {
            e.stopPropagation();
            cancelled.current = false;
            setText(day.title);
          }}
          sx={{ color: onPoster ? POSTER_CREAM : 'text.secondary', flexShrink: 0 }}
        >
          <EditIcon fontSize="small" />
        </IconButton>
      </Box>
    );
  }
  return (
    <TextField
      autoFocus
      fullWidth
      size="small"
      variant="standard"
      value={text}
      placeholder="Day title"
      onChange={(e) => setText(e.target.value)}
      onBlur={finish}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter') finish();
        if (e.key === 'Escape') {
          cancelled.current = true;
          setText(null);
        }
      }}
      slotProps={{
        htmlInput: { 'aria-label': `Title of ${day.dateLabel}` },
        input: { sx: { typography: 'h6', color: ink } },
      }}
    />
  );
}

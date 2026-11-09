import IconButton from '@mui/material/IconButton';
import Paper from '@mui/material/Paper';
import Slider from '@mui/material/Slider';
import Stack from '@mui/material/Stack';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';

import { materialIcon } from '../shared/materialIcon';

const CloseIcon = materialIcon('close');
const PauseIcon = materialIcon('pause');
const PlayArrowIcon = materialIcon('play_arrow');
const SwapHorizIcon = materialIcon('swap_horiz');

// Play and pause, a scrubber, and the example clock for the route preview, with a
// button to run it the other way and one to close it. Nothing here is saved.
export function PreviewBar({
  caption,
  playing,
  progress,
  clock,
  reversed,
  onPlay,
  onPause,
  onSeek,
  onReverse,
  onClose,
}: {
  // What the drive is doing now: driving to a place, or stopped at one.
  caption: string | null;
  playing: boolean;
  progress: number;
  clock: string;
  reversed: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (progress: number) => void;
  onReverse: () => void;
  onClose: () => void;
}) {
  return (
    <Paper
      elevation={4}
      sx={{ p: 1, border: 2, borderStyle: 'solid', borderColor: 'primary.main' }}
    >
      {caption && (
        <Typography variant="body2" sx={{ fontWeight: 700, px: 1 }}>
          {caption}
        </Typography>
      )}
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
        <IconButton
          color="primary"
          aria-label={playing ? 'Pause preview' : 'Play preview'}
          onClick={playing ? onPause : onPlay}
        >
          {playing ? <PauseIcon /> : <PlayArrowIcon />}
        </IconButton>
        <Slider
          size="small"
          min={0}
          max={1}
          step={0.001}
          value={progress}
          aria-label="Preview position"
          onChange={(_, value) => {
            onPause();
            onSeek(value);
          }}
        />
        <Tooltip title="Example times from the example departure. They are never saved.">
          <Typography variant="body2" sx={{ minWidth: 72, textAlign: 'right' }}>
            {clock}
          </Typography>
        </Tooltip>
        <Tooltip title="Preview the other direction. The saved route is not changed.">
          <IconButton
            aria-label="Preview in reverse"
            aria-pressed={reversed}
            color={reversed ? 'primary' : 'default'}
            onClick={onReverse}
          >
            <SwapHorizIcon />
          </IconButton>
        </Tooltip>
        <IconButton aria-label="Close preview" onClick={onClose}>
          <CloseIcon fontSize="small" />
        </IconButton>
      </Stack>
    </Paper>
  );
}

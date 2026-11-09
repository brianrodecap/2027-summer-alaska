import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import Button from '@mui/material/Button';
import Paper from '@mui/material/Paper';
import Stack from '@mui/material/Stack';
import { alpha, useTheme } from '@mui/material/styles';
import Typography from '@mui/material/Typography';

// A change the planner proposes, shown beside what it would change, to accept
// or discard. With nothing to accept (a proposal that changes nothing) there is
// only a way to dismiss it.
export function DraftCard({
  title,
  summary,
  onAccept,
  onDiscard,
  busy = false,
}: {
  title: string;
  summary: string;
  onAccept?: () => void;
  onDiscard: () => void;
  // While a change is being saved, it can't be accepted again.
  busy?: boolean;
}) {
  const color = useTheme().palette.conditions.moon;
  return (
    <Paper
      variant="outlined"
      sx={{ p: 1.5, border: 2, borderColor: color, bgcolor: alpha(color, 0.12) }}
    >
      <Stack spacing={0.75}>
        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', color }}>
          <AutoFixHighIcon fontSize="small" />
          <Typography variant="subtitle2">{title}</Typography>
        </Stack>
        <Typography variant="body2">{summary}</Typography>
        <Stack direction="row" spacing={1}>
          {onAccept && (
            <Button size="small" variant="contained" disabled={busy} onClick={onAccept}>
              Accept
            </Button>
          )}
          <Button size="small" onClick={onDiscard}>
            {onAccept ? 'Discard' : 'OK'}
          </Button>
        </Stack>
      </Stack>
    </Paper>
  );
}

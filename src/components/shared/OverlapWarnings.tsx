import WarningIcon from '@mui/icons-material/Warning';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

// An Activity's warnings (tripModel.ts's activityWarnings) as error-toned
// lines on its row: starting inside a Transit's span (a real stop belongs on
// the Route as a waypoint), inside another Activity's (a meal that happens
// during one is modeled 'included-with-activity'), or ashore outside the
// ship's time in port — flagged rather than passing silently. Several can be
// present at once (rare), so each renders its own line.
export function OverlapWarnings({ warnings }: { warnings: string[] }) {
  if (!warnings.length) return null;
  return (
    <Stack spacing={0.5} sx={{ mt: 0.5 }}>
      {warnings.map((message) => (
        <Stack
          key={message}
          direction="row"
          spacing={0.5}
          sx={{ alignItems: 'center', color: 'error.main' }}
        >
          <WarningIcon fontSize="small" />
          <Typography variant="caption" color="inherit">
            {message}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

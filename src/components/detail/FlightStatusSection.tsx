import Chip from '@mui/material/Chip';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useState } from 'react';

import {
  flightCode,
  flightLookupNote,
  type FlightStatusSummary,
  flightTrackerLinks,
  type FlightWatchState,
  getFlightStatus,
  summarizeFlightStatus,
  watchFlightStatus,
} from '../../model/flightStatus';
import type { EnrichedTransit } from '../../model/types';
import { DetailSection } from './DetailSections';

const CHIP_COLOR: Record<FlightStatusSummary['tone'], 'success' | 'warning' | 'error'> = {
  ok: 'success',
  warning: 'warning',
  problem: 'error',
};

// The browser's timers and page visibility, for watchFlightStatus.
const browserWatch = {
  getFlightStatus,
  setTimeout: (run: () => void, ms: number) => window.setTimeout(run, ms),
  clearTimeout: (timer: unknown) => window.clearTimeout(timer as number),
  visible: () => document.visibilityState === 'visible',
  onVisible: (run: () => void) => {
    const listener = () => {
      if (document.visibilityState === 'visible') run();
    };
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  },
};

// The watched flight's state while the sheet is open, tagged with the flight it's
// for so a renumbered flight never shows the old one's status. It stays when the
// sheet closes, so reopening shows it at once.
function useFlightWatch(transit: EnrichedTransit, flight: string | null, open: boolean) {
  const [watched, setWatched] = useState<{ flight: string; state: FlightWatchState } | null>(null);
  useEffect(() => {
    if (!open || !flight) return;
    return watchFlightStatus(transit, (state) => setWatched({ flight, state }), browserWatch);
  }, [transit, flight, open]);
  return watched?.flight === flight ? watched.state : null;
}

// "Flight status": live status around the day it flies, and the public trackers
// any day. Nothing for a Transit without a flight number.
export function FlightStatusSection({
  transit,
  open,
}: {
  transit: EnrichedTransit;
  open: boolean;
}) {
  const code = flightCode(transit);
  const state = useFlightWatch(transit, code && `${code}|${transit.departsAt}`, open);
  if (!code) return null;
  const lookup = state?.lookup ?? null;
  const summary = lookup?.kind === 'status' ? summarizeFlightStatus(lookup.status) : null;
  const note = lookup && flightLookupNote(lookup);

  return (
    <DetailSection title="Flight status">
      {state?.error && (
        <Typography variant="body2" color="error">
          {state.error}
        </Typography>
      )}
      {summary ? (
        <Stack spacing={0.5} sx={{ alignItems: 'flex-start' }}>
          <Chip size="small" color={CHIP_COLOR[summary.tone]} label={summary.headline} />
          {summary.departure && (
            <Typography variant="body2">Departure: {summary.departure}</Typography>
          )}
          {summary.arrival && <Typography variant="body2">Arrival: {summary.arrival}</Typography>}
        </Stack>
      ) : note ? (
        <Typography variant="body2" color="text.secondary">
          {note}
        </Typography>
      ) : (
        open && !state && <Skeleton width="60%" />
      )}
      <Stack direction="row" spacing={2}>
        {flightTrackerLinks(code).map(({ label, url }) => (
          <Link key={label} href={url} target="_blank" rel="noopener" variant="body2">
            {label}
          </Link>
        ))}
      </Stack>
    </DetailSection>
  );
}

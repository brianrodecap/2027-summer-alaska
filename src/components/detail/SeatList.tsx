import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import type { EnrichedTransit } from '../../model/types';
import { useTravelerNames } from '../../state/useTravelerNames';
import { DetailSection } from './DetailSections';

// One line per seated traveler on this Transit: "Brian Rodecap — 22A · Coach (N)".
export function SeatList({ transit }: { transit: EnrichedTransit }) {
  const names = useTravelerNames();
  if (!transit.seats?.length) return null;
  return (
    <DetailSection title="Seats">
      <Box component="ul" sx={{ pl: 2, m: 0 }}>
        {transit.seats.map((s) => (
          <Typography component="li" variant="body2" key={s.travelerId}>
            {names.get(s.travelerId) ?? s.travelerId} — {s.seat}
            {s.cabin ? ` · ${s.cabin}` : ''}
            {s.fareClass ? ` (${s.fareClass})` : ''}
          </Typography>
        ))}
      </Box>
    </DetailSection>
  );
}

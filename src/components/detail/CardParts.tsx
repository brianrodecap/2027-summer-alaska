import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import type { ReactNode } from 'react';

import type { CardTraveler } from '../../model/cardTravelers';

// A plain line of an expanded card's row details.
export function CardLine({ children, quiet }: { children: ReactNode; quiet?: boolean }) {
  return (
    <Typography variant="body2" color={quiet ? 'text.secondary' : 'text.primary'}>
      {children}
    </Typography>
  );
}

// The travelers an expanded card lists (cardTravelers), each with their seat.
export function TravelerList({ travelers }: { travelers: CardTraveler[] | null }) {
  if (!travelers) return null;
  return (
    <Box
      component="ul"
      aria-label="Travelers"
      sx={{
        listStyle: 'none',
        m: 0,
        mt: 1,
        px: 1.25,
        py: 0.75,
        borderRadius: 1.5,
        bgcolor: 'surfaceContainer.high',
      }}
    >
      {travelers.map((traveler, i) => (
        <Box
          component="li"
          // two travelers can share a first name; the list never reorders
          key={i}
          sx={{ display: 'flex', justifyContent: 'space-between', gap: 2 }}
        >
          <Typography variant="body2">{traveler.name}</Typography>
          {traveler.detail && (
            <Typography variant="body2" color="text.secondary">
              {traveler.detail}
            </Typography>
          )}
        </Box>
      ))}
    </Box>
  );
}

// What Google says about a card's places (or, for a place with no Google id, the
// contacts recorded for it). Mounted only on an open card, so nothing is looked up
// for a closed one.
export function GoogleBox({ fromGoogle, children }: { fromGoogle: boolean; children: ReactNode }) {
  return (
    <Box sx={{ mt: 1.5, p: 1.25, border: 1, borderColor: 'divider', borderRadius: 1.5 }}>
      {fromGoogle && (
        <Typography variant="overline" color="text.secondary">
          From Google
        </Typography>
      )}
      {children}
    </Box>
  );
}

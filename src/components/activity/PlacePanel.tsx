import LanguageIcon from '@mui/icons-material/Language';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlaceIcon from '@mui/icons-material/Place';
import ScheduleIcon from '@mui/icons-material/Schedule';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import type { Place } from '../../model/types';
import { usePlaceDetails } from './usePlaceDetails';

// Fallback shown when the API key isn't configured yet or a lookup fails —
// still gives a working outbound link so the feature degrades rather than
// dies. Uses query_place_id when we have the pinned id (an exact deep link
// to the right business), falling back to a plain text search otherwise.
function placeSearchUrl(place: Place): string {
  const query = encodeURIComponent(place.label);
  return place.id
    ? `https://www.google.com/maps/search/?api=1&query=${query}&query_place_id=${place.id}`
    : `https://www.google.com/maps/search/?api=1&query=${query}`;
}

// Only draws on fields the Places API (New) actually returns for this site's
// deliberately Enterprise-tier-only field mask — no photos/rating/reviews
// (see model/places.ts).
export function PlacePanel({ place }: { place: Place }) {
  const { details, loading, failed, configured } = usePlaceDetails(place.id);

  // A named-but-unresolved place (place.id: null — a shipboard restaurant
  // with no static geolocation, say) has nothing to fetch at all — the hook
  // above still gets called every render (rules-of-hooks), it just reports
  // loading: false and nothing to show.
  if (!place.id) return null;

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', py: 2 }}>
        <CircularProgress size={24} />
      </Box>
    );
  }

  if (!configured || failed || !details) {
    return (
      <Stack spacing={1} sx={{ mt: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {configured
            ? 'Live details unavailable right now.'
            : 'Add a Places API key to enable live details.'}
        </Typography>
        <Link href={placeSearchUrl(place)} target="_blank" rel="noopener">
          Search Google Maps
        </Link>
      </Stack>
    );
  }

  return (
    <Stack spacing={1.5} sx={{ mt: 1 }}>
      {details.formattedAddress && (
        <Stack direction="row" spacing={1}>
          <PlaceIcon fontSize="small" color="action" />
          <Typography variant="body2">{details.formattedAddress}</Typography>
        </Stack>
      )}
      {details.regularOpeningHours && (
        <Stack direction="row" spacing={1}>
          <ScheduleIcon fontSize="small" color="action" />
          <Box>
            <Typography variant="body2">
              {details.regularOpeningHours.openNow ? 'Open now' : 'Closed now'}
            </Typography>
            {details.regularOpeningHours.weekdayDescriptions?.map((line) => (
              <Typography key={line} variant="caption" color="text.secondary" component="div">
                {line}
              </Typography>
            ))}
          </Box>
        </Stack>
      )}
      <Stack direction="row" spacing={2}>
        {details.websiteUri && (
          <Link
            href={details.websiteUri}
            target="_blank"
            rel="noopener"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <LanguageIcon fontSize="small" /> Website
          </Link>
        )}
        {details.googleMapsUri && (
          <Link
            href={details.googleMapsUri}
            target="_blank"
            rel="noopener"
            sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}
          >
            <OpenInNewIcon fontSize="small" /> View on Google Maps
          </Link>
        )}
      </Stack>
    </Stack>
  );
}

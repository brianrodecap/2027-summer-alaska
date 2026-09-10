import LanguageIcon from '@mui/icons-material/Language';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import PlaceIcon from '@mui/icons-material/Place';
import ScheduleIcon from '@mui/icons-material/Schedule';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useEffect, useMemo, useRef } from 'react';

import {
  MAX_PHOTOS,
  photoThumbnailUrl,
  type PlaceAuthorAttribution,
  placeImageFromPhoto,
  type PlacePhoto,
} from '../../model/places';
import type { Image, Place } from '../../model/types';
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

// One attribution per distinct author (Google's own listing can repeat the
// same photographer across several photos) — the display name is always
// present, a profile link only sometimes.
function uniqueAttributions(photos: PlacePhoto[]): PlaceAuthorAttribution[] {
  const byName = new Map<string, PlaceAuthorAttribution>();
  for (const photo of photos) {
    const attribution = photo.authorAttributions?.[0];
    if (attribution && !byName.has(attribution.displayName)) {
      byName.set(attribution.displayName, attribution);
    }
  }
  return [...byName.values()];
}

// A horizontal thumbnail strip of whatever photos Google currently lists for
// this place — live only, never persisted (see placeImageFromPhoto, called
// only for whichever single photo a click actually picks). Each <img> is
// fetched at a size matched to its own 120x90 display, not the larger size a
// chosen hero gets — requesting hero-sized media for every thumbnail here
// was pulling down several times the pixel data any of them needed, on every
// lookup. loading="lazy" also means a thumbnail scrolled out of the strip's
// own view is never fetched until a viewer actually scrolls to it. Google's
// terms require the author attribution shown alongside each photo, hence the
// caption line below the strip rather than dropping it. Clicking a thumbnail
// makes it the entity's hero image, the same one EntityHeroImage shows at the
// top of the sheet.
function PlacePhotoStrip({
  photos,
  onSelect,
}: {
  photos: PlacePhoto[];
  onSelect: (photo: PlacePhoto) => void;
}) {
  const attributions = useMemo(() => uniqueAttributions(photos), [photos]);
  if (!photos.length) return null;
  return (
    <Stack spacing={0.5}>
      <Stack direction="row" spacing={1} sx={{ overflowX: 'auto' }}>
        {photos.map((photo) => (
          <Box
            key={photo.name}
            component="img"
            src={photoThumbnailUrl(photo.name)}
            loading="lazy"
            alt=""
            title={photo.authorAttributions?.[0]?.displayName}
            onClick={() => onSelect(photo)}
            sx={{
              width: 120,
              height: 90,
              objectFit: 'cover',
              borderRadius: 1,
              flexShrink: 0,
              cursor: 'pointer',
            }}
          />
        ))}
      </Stack>
      {attributions.length > 0 && (
        <Typography variant="caption" color="text.secondary">
          Photos:{' '}
          {attributions.map((a, i) => (
            <span key={a.displayName}>
              {i > 0 && ', '}
              {a.uri ? (
                <Link href={a.uri} target="_blank" rel="noopener">
                  {a.displayName}
                </Link>
              ) : (
                a.displayName
              )}
            </span>
          ))}
        </Typography>
      )}
    </Stack>
  );
}

// Only draws on fields the Places API (New) actually returns for this site's
// field mask — hours/website/maps link (Enterprise) plus photos (the
// separate, cheaper Photos SKU) — still nothing from Enterprise+Atmosphere
// (no rating/reviews; see model/places.ts).
export function PlacePanel({
  place,
  onSelectImage,
  onAutoImage,
}: {
  place: Place;
  // Fires when a viewer clicks one thumbnail in the photo strip below,
  // naming it the entity's new hero image (see formatting.ts's
  // withHeroImage — every DetailPanel writes this into its own top-level
  // `images`, not this place's, since that's the array firstImage always
  // checks first). An explicit click always overrides whatever onAutoImage
  // below has backfilled.
  onSelectImage: (image: Image) => void;
  // Fires at most once per place, automatically, the moment a live lookup
  // first returns a photo for a place that has no images of its own yet
  // (see the persisted ref below) — backfills Place.images (see
  // usePlaceImagePersist) so a browsed-but-never-edited activity/meal/stay/
  // transit still ends up with a photo without requiring a manual click.
  // Omitted where a caller has no Place-level images field to write back to.
  onAutoImage?: (image: Image) => void;
}) {
  const { details, loading, failed, configured } = usePlaceDetails(place.id);
  const photos = useMemo(() => (details?.photos ?? []).slice(0, MAX_PHOTOS), [details?.photos]);

  // Guards against persisting twice for the same place (React StrictMode's
  // double-invoke, or this effect re-running as `photos` gets a new array
  // identity on every fetch resolution) — reset whenever the place itself
  // changes, since a different place's lookup is a genuinely new backfill
  // opportunity, not a repeat of this one.
  const persistedPlaceId = useRef<string | null>(null);
  useEffect(() => {
    if (!onAutoImage || place.images?.length) return;
    if (persistedPlaceId.current === place.id) return;
    const photo = photos[0];
    if (!photo) return;
    persistedPlaceId.current = place.id;
    onAutoImage(placeImageFromPhoto(photo));
  }, [photos, place.id, place.images, onAutoImage]);

  // A named-but-unresolved place (place.id: null — a shipboard restaurant
  // with no static geolocation, say) has nothing to fetch at all — the hooks
  // above still get called every render (rules-of-hooks), they just report
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
      <PlacePhotoStrip
        photos={photos}
        onSelect={(photo) => onSelectImage(placeImageFromPhoto(photo))}
      />
    </Stack>
  );
}

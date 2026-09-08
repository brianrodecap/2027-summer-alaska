import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { isSunAnchoredActivity, sunAnchoredTimeLabel } from '../../model/formatting';
import { isPlacesApiKeyConfigured } from '../../model/places';
import { resolveSunPlaceId } from '../../model/tripModel';
import type { Day, EnrichedActivity } from '../../model/types';
import { getPlaceSunriseSunset, type PlaceSunriseSunset } from '../../model/weather';

// A sun-anchored ('Sunrise'/'Sunset' timeLabel, no startAt) Activity's
// overline time text, folding in a real computed clock time once one
// resolves (see sunAnchoredTimeLabel) — undefined for every other Activity
// (real startAt, or a different fuzzy label entirely), so callers can use it
// directly as timeAndMealTypeLabel's timeOverride without re-checking
// isSunAnchoredActivity themselves. `active` gates the fetch the same way
// DayWeatherStrip/PlaceConditionsLine gate on viewport visibility — the
// caller passes its own inView check through rather than this hook owning
// one, since it's meant to sit inside an already-viewport-gated row.
export function useSunAnchoredTime(
  activity: EnrichedActivity,
  day: Day,
  active: boolean,
): string | undefined {
  const anchored = active && isSunAnchoredActivity(activity);
  const placeId = anchored ? resolveSunPlaceId(activity, day) : null;
  const shouldFetch = Boolean(placeId) && isPlacesApiKeyConfigured();
  const key = placeId ? `${placeId}|${day.date}` : null;

  const { value } = useKeyedAsync<string, PlaceSunriseSunset | null>(key, shouldFetch, () =>
    getPlaceSunriseSunset(placeId as string, day.date),
  );
  return anchored ? sunAnchoredTimeLabel(activity.timeLabel as string, value) : undefined;
}

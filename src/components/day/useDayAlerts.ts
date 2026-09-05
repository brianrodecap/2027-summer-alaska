import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { getAlertsForPlaces, type NwsAlert } from '../../model/nwsAlerts';
import { isPlacesApiKeyConfigured } from '../../model/places';
import { addDaysStr, todayDateStr } from '../../model/tripModel';

// Gates the NWS lookup to only the day matching the real-world "today" or
// "tomorrow" (see nwsAlerts.ts's own note on why: an active alert only ever
// answers "right now," so asking about any other trip date would either
// return nothing meaningful or, worse, look like a real answer for a day
// that's actually years away). Same "key the last result by what it was
// fetched for" pattern as useDayWeather, keyed on the day's own place ids so
// a stale banner from a different day's places can't flash while this one's
// request is still in flight. No loading state exposed — DayAlertsBanner has
// nothing to show while waiting, so there's no skeleton to gate on it.
export function useDayAlerts(date: string, placeIds: (string | null)[]): { alerts: NwsAlert[] } {
  const isRelevant = date === todayDateStr() || date === addDaysStr(todayDateStr(), 1);
  const uniqueIds = [...new Set(placeIds.filter((id): id is string => Boolean(id)))].sort();
  const shouldFetch = isRelevant && uniqueIds.length > 0 && isPlacesApiKeyConfigured();
  const key = shouldFetch ? uniqueIds.join('|') : null;

  const { value } = useKeyedAsync(key, shouldFetch, () => getAlertsForPlaces(uniqueIds));

  return { alerts: value ?? [] };
}

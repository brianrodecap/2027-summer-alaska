import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { getCoordinates } from '../../model/placeCoordinates';
import { weatherAppUrl } from '../../model/weatherLink';

// A tappable link target for one place's weather row — resolves the same
// coordinate cache weather.ts's own per-place lookups already populate (see
// placeCoordinates.ts), so this is usually already-cached by the time a
// weather reading itself has finished loading, rather than a second cold
// lookup. Null while unresolved or when there's no place to link to.
export function usePlaceWeatherLink(placeId: string | null): string | null {
  const { value } = useKeyedAsync(placeId, placeId !== null, async (id: string) => {
    const coords = await getCoordinates(id);
    return weatherAppUrl(coords);
  });
  return value;
}

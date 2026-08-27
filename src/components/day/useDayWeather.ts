import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { isPlacesApiKeyConfigured } from '../../model/places';
import { type DayWeather, type DayWeatherPlaces, getDayWeather } from '../../model/weather';

interface DayWeatherState {
  weather: DayWeather | null;
  loading: boolean;
  failed: boolean;
}

// Same "key the last result by what it was fetched for" pattern as
// usePlaceDetails (see useKeyedAsync), just keyed on the three place ids +
// date together — the same place can be looked up for several different days
// (a multi-night Stay), and each one needs its own forecast-vs-average result.
export function useDayWeather(places: DayWeatherPlaces, date: string): DayWeatherState {
  const { sunrisePlaceId, sunsetPlaceId, weatherPlaceId, airQualityPlaceId, marinePlaceId } =
    places;
  const hasAnyPlace = Boolean(
    sunrisePlaceId || sunsetPlaceId || weatherPlaceId || airQualityPlaceId || marinePlaceId,
  );
  const shouldFetch = hasAnyPlace && isPlacesApiKeyConfigured();
  const key = hasAnyPlace
    ? `${sunrisePlaceId}|${sunsetPlaceId}|${weatherPlaceId}|${airQualityPlaceId}|${marinePlaceId}|${date}`
    : null;

  const {
    value: weather,
    loading,
    failed,
  } = useKeyedAsync(key, shouldFetch, () => getDayWeather(places, date));

  return { weather, loading, failed };
}

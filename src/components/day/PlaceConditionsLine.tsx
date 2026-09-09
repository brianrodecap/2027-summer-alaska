import TerrainIcon from '@mui/icons-material/Terrain';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { getElevationFt } from '../../model/elevation';
import { isPlacesApiKeyConfigured } from '../../model/places';
import type { Place } from '../../model/types';
import { getPlaceTemperature, type PlaceTemperature } from '../../model/weather';
import { temperatureColor } from '../../model/weatherColors';
import { WeatherLink } from './DayWeatherStrip';
import { useInViewport } from './useInViewport';
import { usePlaceWeatherLink } from './usePlaceWeatherLink';

// Terrain brown — reviewed alongside the mockup, distinct from every color
// DayWeatherStrip's own palette already uses.
const ELEVATION_COLOR = '#8d6e63';

function usePlaceTemperature(placeId: string | null, date: string) {
  const key = placeId ? `${placeId}|${date}` : null;
  return useKeyedAsync<string, PlaceTemperature | null>(key, key !== null, () =>
    getPlaceTemperature(placeId as string, date),
  );
}

function usePlaceElevation(placeId: string | null) {
  return useKeyedAsync<string, number | null>(placeId, placeId !== null, () =>
    getElevationFt(placeId as string),
  );
}

// The per-entity "show weather"/"show elevation at this place" row (see
// Place.showWeather/showElevation and ActivityEditForm's own toggles) —
// renders right after a row's description, ahead of its
// notes/travelers/booking chip, since this is primary information about the
// entry rather than a footnote. Off (renders nothing) unless at least one
// toggle is on and the entity actually resolves a Place.
//
// Gated behind the same viewport check DayWeatherStrip uses: DaysView mounts
// every day's rows at once regardless of scroll position, so without this
// every enabled row across the whole trip would fetch the instant the page
// loads instead of as each one actually scrolls into view.
export function PlaceConditionsLine({ place, date }: { place: Place | null; date: string }) {
  const placeId = place?.id ?? null;
  const showWeather = Boolean(place?.showWeather);
  const showElevation = Boolean(place?.showElevation);
  const wantsAny = Boolean(placeId) && (showWeather || showElevation) && isPlacesApiKeyConfigured();
  const { ref, inView } = useInViewport<HTMLDivElement>();
  const activePlaceId = wantsAny && inView ? placeId : null;

  const { value: weather, loading: weatherLoading } = usePlaceTemperature(
    showWeather ? activePlaceId : null,
    date,
  );
  const { value: elevationFt, loading: elevationLoading } = usePlaceElevation(
    showElevation ? activePlaceId : null,
  );
  const weatherHref = usePlaceWeatherLink(weather ? activePlaceId : null);

  if (!wantsAny) return null;
  if (!inView || weatherLoading || elevationLoading) {
    return <Skeleton ref={ref} variant="text" width={130} sx={{ mt: 0.5 }} />;
  }
  if (weather === null && elevationFt === null) return null;

  const weatherRow = weather && (
    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
      <ThermostatIcon
        fontSize="inherit"
        sx={{ color: temperatureColor(weather.highF), fontSize: '1rem' }}
      />
      <Typography variant="body2" color="text.secondary">
        <Typography
          component="span"
          variant="body2"
          sx={{ color: temperatureColor(weather.highF) }}
        >
          {weather.highF}°/{weather.lowF}°
        </Typography>{' '}
        ({weather.isForecast ? 'forecast' : 'avg'})
      </Typography>
    </Stack>
  );

  return (
    <Stack spacing={0.3} sx={{ mt: 0.5 }}>
      {weatherRow && (
        <WeatherLink href={weatherHref} sx={{ alignSelf: 'flex-start' }}>
          {weatherRow}
        </WeatherLink>
      )}
      {elevationFt !== null && (
        <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <TerrainIcon fontSize="inherit" sx={{ color: ELEVATION_COLOR, fontSize: '1rem' }} />
          <Typography variant="body2" color="text.secondary">
            <Typography component="span" variant="body2" sx={{ color: ELEVATION_COLOR }}>
              ≈{elevationFt.toLocaleString()} ft
            </Typography>{' '}
            elevation
          </Typography>
        </Stack>
      )}
    </Stack>
  );
}

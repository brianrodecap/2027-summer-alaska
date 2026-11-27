import TerrainIcon from '@mui/icons-material/Terrain';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';

import { hasGoogleApiKey } from '../../config/apiKeys';
import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { getElevationFt } from '../../model/elevation';
import { temperatureLabel } from '../../model/formatting';
import { todayDateStr } from '../../model/tripModel';
import type { Place } from '../../model/types';
import { getPlaceTemperature, type PlaceTemperature } from '../../model/weather';
import { temperatureColor } from '../../model/weatherColors';
import { InfoLink } from '../shared/InfoChip';
import { useInViewport } from './useInViewport';
import { usePlaceWeatherLink } from './usePlaceWeatherLink';

function usePlaceTemperature(placeId: string | null, date: string) {
  const key = placeId ? `${placeId}|${date}` : null;
  return useKeyedAsync<string, PlaceTemperature | null>(key, key !== null, () =>
    getPlaceTemperature(placeId as string, date, todayDateStr()),
  );
}

function usePlaceElevation(placeId: string | null) {
  return useKeyedAsync<string, number | null>(placeId, placeId !== null, () =>
    getElevationFt(placeId as string),
  );
}

// The per-entity "show weather"/"show elevation at this place" column (see
// Place.showWeather/showElevation and ActivityEditForm's own toggles) —
// sits in a card's header, right of the name and left of the photo. Off (renders
// nothing) unless at least one toggle is on and the entity actually resolves a Place.
//
// Gated behind the same viewport check DayWeatherChips uses: DaysView mounts
// every day's rows at once regardless of scroll position, so without this
// every enabled row across the whole trip would fetch the instant the page
// loads instead of as each one actually scrolls into view.
export function PlaceConditionsLine({ place, date }: { place: Place | null; date: string }) {
  const placeId = place?.id ?? null;
  const showWeather = Boolean(place?.showWeather);
  const showElevation = Boolean(place?.showElevation);
  const wantsAny = Boolean(placeId) && (showWeather || showElevation) && hasGoogleApiKey();
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
    return <Skeleton ref={ref} variant="text" width={56} />;
  }
  if (weather === null && elevationFt === null) return null;

  return (
    <Stack spacing={0.25} sx={{ alignItems: 'flex-end' }}>
      {/* one line, colored like the day header's: the icon by the heat, plain text */}
      {weather && (
        <InfoLink href={weatherHref}>
          <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
            <ThermostatIcon
              titleAccess="Temperature"
              sx={{ color: temperatureColor(weather.highF), fontSize: '1rem' }}
            />
            <Typography variant="caption" color="text.secondary" noWrap>
              {temperatureLabel(weather.highF, weather.lowF, weather.isForecast)}
            </Typography>
          </Stack>
        </InfoLink>
      )}
      {elevationFt !== null && (
        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
          <TerrainIcon
            titleAccess="Approximate elevation"
            fontSize="inherit"
            sx={{ color: 'conditions.elevation', fontSize: '1rem' }}
          />
          <Typography variant="caption" sx={{ color: 'conditions.elevation' }}>
            ≈{elevationFt.toLocaleString()} ft
          </Typography>
        </Stack>
      )}
    </Stack>
  );
}

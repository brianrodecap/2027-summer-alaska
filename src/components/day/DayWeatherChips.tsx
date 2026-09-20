import AirIcon from '@mui/icons-material/Air';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import GrainIcon from '@mui/icons-material/Grain';
import LightModeIcon from '@mui/icons-material/LightMode';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import WavesIcon from '@mui/icons-material/Waves';
import Box from '@mui/material/Box';
import Skeleton from '@mui/material/Skeleton';

import { getMoonPhase } from '../../model/moonPhase';
import type { Day } from '../../model/types';
import { aqiBand, CLOUD_COLOR, RAIN_COLOR, temperatureColor } from '../../model/weatherColors';
import { InfoChip, type InfoChipData } from '../shared/InfoChip';
import { useDayWeather } from './useDayWeather';
import { usePlaceWeatherLink } from './usePlaceWeatherLink';

// A Stay only ever carries deckGroup/shipZone when its Lodging is a cruise
// cabin (see Lodging's own "cruise-cabin-only extensions" note in
// model/types.ts) — the generic, trip-agnostic way to recognize "this day is
// aboard the ship" without hardcoding this trip's leg id.
function isCruiseDay(day: Day): boolean {
  return day.stays.some((s) => Boolean(s.lodging?.deckGroup || s.lodging?.shipZone));
}

// The day header's own weather/moon-phase row — its own live fetch, gated by
// DayAccordion's shared viewport latch (passed down as `inView`) rather than
// a latch of its own; DayTravelChip is the sibling row that shares the same
// gate and no other code beyond InfoChip itself. Live-only, per the note on
// Day.sunrisePlaceId/sunsetPlaceId/weatherPlaceId: refetched on every visit,
// never persisted alongside the trip's own JSON. Renders nothing at all
// (rather than an error state) whenever there's no real place to look up, or
// the lookup fails — this is a nice-to-have row, not something worth drawing
// attention to when it can't resolve.
//
// DaysView renders every Day block unvirtualized (~28 for this trip), so
// without that gate this would fire every day's weather lookup the instant
// the page loads instead of as each day actually scrolls into view.
export function DayWeatherChips({ day, inView }: { day: Day; inView: boolean }) {
  const hasAnyPlace = Boolean(day.sunrisePlaceId || day.sunsetPlaceId || day.weatherPlaceId);
  // Air quality wants a place for every day, even one with no dedicated
  // weatherPlaceId of its own (a cruise day with no priority Activity) — the
  // same fallback chain weatherPlaceId itself already falls back through.
  const airQualityPlaceId = day.weatherPlaceId ?? day.sunsetPlaceId ?? day.sunrisePlaceId;
  const marinePlaceId = isCruiseDay(day) ? airQualityPlaceId : null;
  const { weather, loading, failed } = useDayWeather(
    {
      sunrisePlaceId: inView ? day.sunrisePlaceId : null,
      sunsetPlaceId: inView ? day.sunsetPlaceId : null,
      weatherPlaceId: inView ? day.weatherPlaceId : null,
      airQualityPlaceId: inView ? airQualityPlaceId : null,
      marinePlaceId: inView ? marinePlaceId : null,
    },
    day.date,
  );
  const sunriseHref = usePlaceWeatherLink(inView ? day.sunrisePlaceId : null);
  const sunsetHref = usePlaceWeatherLink(inView ? day.sunsetPlaceId : null);
  const weatherHref = usePlaceWeatherLink(inView ? day.weatherPlaceId : null);
  const aqiHref = usePlaceWeatherLink(inView ? airQualityPlaceId : null);
  const marineHref = usePlaceWeatherLink(inView ? marinePlaceId : null);

  if (!hasAnyPlace || failed) return null;

  if (!inView || loading || !weather) {
    return <Skeleton variant="text" width={200} />;
  }

  const rows: InfoChipData[] = [];
  if (weather.sunrise) {
    rows.push({
      key: 'sunrise',
      Icon: LightModeIcon,
      color: 'conditions.sunrise',
      text: weather.sunrise,
      href: sunriseHref,
    });
  }
  if (weather.sunset) {
    rows.push({
      key: 'sunset',
      Icon: NightsStayIcon,
      color: 'conditions.sunset',
      text: weather.sunset,
      href: sunsetHref,
    });
  }
  const moon = getMoonPhase(day.date);
  rows.push({ key: 'moon', emoji: moon.emoji, color: 'conditions.moon', text: moon.name });
  if (weather.highF !== null && weather.lowF !== null) {
    rows.push({
      key: 'temp',
      Icon: ThermostatIcon,
      color: temperatureColor(weather.highF),
      text: `${weather.highF}°/${weather.lowF}° ${weather.isForecast ? '(forecast)' : '(avg)'}`,
      href: weatherHref,
    });
  }
  if (weather.cloudCoverPct !== null) {
    rows.push({
      key: 'cloud',
      Icon: CloudQueueIcon,
      color: CLOUD_COLOR,
      text: `${weather.cloudCoverPct}%`,
      href: weatherHref,
    });
  }
  if (weather.precipProbabilityPct !== null) {
    rows.push({
      key: 'rain',
      Icon: WaterDropIcon,
      color: RAIN_COLOR,
      text: `${weather.precipProbabilityPct}%`,
      href: weatherHref,
    });
  }
  if (weather.windMph !== null) {
    rows.push({
      key: 'wind',
      Icon: AirIcon,
      color: 'conditions.wind',
      text: `${weather.windMph} mph`,
      href: weatherHref,
    });
  }
  if (weather.aqi !== null) {
    const { color, label } = aqiBand(weather.aqi);
    rows.push({
      key: 'aqi',
      Icon: GrainIcon,
      color,
      text: `AQI ${weather.aqi} (${label})`,
      href: aqiHref,
    });
  }
  if (weather.waveHeightFt !== null) {
    rows.push({
      key: 'waves',
      Icon: WavesIcon,
      color: 'conditions.wave',
      text: `${weather.waveHeightFt} ft seas`,
      href: marineHref,
    });
  }

  if (rows.length === 0) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        columnGap: 1.75,
        rowGap: 0.75,
      }}
    >
      {rows.map(({ key, ...chip }) => (
        <InfoChip key={key} {...chip} />
      ))}
    </Box>
  );
}

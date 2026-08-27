import AirIcon from '@mui/icons-material/Air';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import GrainIcon from '@mui/icons-material/Grain';
import LightModeIcon from '@mui/icons-material/LightMode';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import WavesIcon from '@mui/icons-material/Waves';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';
import { type ComponentType } from 'react';

import type { Day } from '../../model/types';
import { useDayWeather } from './useDayWeather';
import { useInViewport } from './useInViewport';

type IconComponent = ComponentType<SvgIconProps>;

const SUNRISE_COLOR = '#f9a825'; // warm gold
const SUNSET_COLOR = '#5c6bc0'; // dusk indigo
const CLOUD_COLOR = '#78909c'; // overcast blue-grey
const RAIN_COLOR = '#1e88e5'; // rain blue
const WIND_COLOR = '#00897b'; // breeze teal
const WAVE_COLOR = '#0277bd'; // ocean blue — distinct from WIND_COLOR's teal and SUNSET_COLOR's indigo

// A fixed palette keyed to how a high actually feels, rather than one flat
// "weather" color for every day — a 42° glacier day and a 78° cruise-port
// day shouldn't read the same at a glance.
function temperatureColor(highF: number): string {
  if (highF >= 75) return '#d84315'; // hot
  if (highF >= 60) return '#ef6c00'; // warm
  if (highF >= 45) return '#2e7d32'; // mild
  if (highF >= 32) return '#1565c0'; // cool
  return '#6a1b9a'; // freezing
}

// Standard EPA US AQI breakpoints — same six-category scale AirNow and every
// other US air-quality display uses, so this doesn't invent its own scale.
// One ladder shared by color and label, rather than two parallel if-chains
// over the same breakpoints.
const AQI_BANDS: { max: number; color: string; label: string }[] = [
  { max: 50, color: '#2e7d32', label: 'Good' },
  { max: 100, color: '#f9a825', label: 'Moderate' },
  { max: 150, color: '#ef6c00', label: 'USG' },
  { max: 200, color: '#d84315', label: 'Unhealthy' },
  { max: 300, color: '#6a1b9a', label: 'Very unhealthy' },
  { max: Infinity, color: '#4e342e', label: 'Hazardous' },
];

function aqiBand(aqi: number): { color: string; label: string } {
  return AQI_BANDS.find((band) => aqi <= band.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

// A Stay only ever carries deckGroup/shipZone when its Lodging is a cruise
// cabin (see Lodging's own "cruise-cabin-only extensions" note in
// model/types.ts) — the generic, trip-agnostic way to recognize "this day is
// aboard the ship" without hardcoding this trip's leg id.
function isCruiseDay(day: Day): boolean {
  return day.stays.some((s) => Boolean(s.lodging?.deckGroup || s.lodging?.shipZone));
}

interface WeatherRow {
  key: string;
  Icon: IconComponent;
  color: string;
  text: string;
}

// Live-only, per the note on Day.sunrisePlaceId/sunsetPlaceId/weatherPlaceId:
// refetched on every visit, never persisted alongside the trip's own JSON.
// Renders nothing at all (rather than an error state) whenever there's no
// real place to look up, or the lookup fails — this is a nice-to-have
// strip, not something worth drawing attention to when it can't resolve.
//
// DaysView renders every Day block unvirtualized (~28 for this trip), so
// without a viewport gate this would fire every day's weather lookup the
// instant the page loads instead of as each day actually scrolls into
// view — useInViewport's default 600px rootMargin starts the fetch a
// little before the strip is actually on screen, so it's normally already
// resolved by the time a normal scroll speed reaches it.
export function DayWeatherStrip({ day }: { day: Day }) {
  const hasAnyPlace = Boolean(day.sunrisePlaceId || day.sunsetPlaceId || day.weatherPlaceId);
  // Air quality wants a place for every day, even one with no dedicated
  // weatherPlaceId of its own (a cruise day with no priority Activity) — the
  // same fallback chain weatherPlaceId itself already falls back through.
  const airQualityPlaceId = day.weatherPlaceId ?? day.sunsetPlaceId ?? day.sunrisePlaceId;
  const marinePlaceId = isCruiseDay(day) ? airQualityPlaceId : null;
  const { ref, inView } = useInViewport<HTMLDivElement>();
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

  if (!hasAnyPlace || failed) return null;

  if (!inView || loading || !weather) {
    return <Skeleton ref={ref} variant="text" width={220} sx={{ mb: 1.5 }} />;
  }

  const rows: WeatherRow[] = [];
  if (weather.sunrise) {
    rows.push({ key: 'sunrise', Icon: LightModeIcon, color: SUNRISE_COLOR, text: weather.sunrise });
  }
  if (weather.sunset) {
    rows.push({ key: 'sunset', Icon: NightsStayIcon, color: SUNSET_COLOR, text: weather.sunset });
  }
  if (weather.highF !== null && weather.lowF !== null) {
    rows.push({
      key: 'temp',
      Icon: ThermostatIcon,
      color: temperatureColor(weather.highF),
      text: `${weather.highF}°/${weather.lowF}° ${weather.isForecast ? '(forecast)' : '(avg)'}`,
    });
  }
  if (weather.cloudCoverPct !== null) {
    rows.push({
      key: 'cloud',
      Icon: CloudQueueIcon,
      color: CLOUD_COLOR,
      text: `${weather.cloudCoverPct}%`,
    });
  }
  if (weather.precipProbabilityPct !== null) {
    rows.push({
      key: 'rain',
      Icon: WaterDropIcon,
      color: RAIN_COLOR,
      text: `${weather.precipProbabilityPct}%`,
    });
  }
  if (weather.windMph !== null) {
    rows.push({ key: 'wind', Icon: AirIcon, color: WIND_COLOR, text: `${weather.windMph} mph` });
  }
  if (weather.aqi !== null) {
    const { color, label } = aqiBand(weather.aqi);
    rows.push({ key: 'aqi', Icon: GrainIcon, color, text: `AQI ${weather.aqi} (${label})` });
  }
  if (weather.waveHeightFt !== null) {
    rows.push({
      key: 'waves',
      Icon: WavesIcon,
      color: WAVE_COLOR,
      text: `${weather.waveHeightFt} ft seas`,
    });
  }

  return (
    <Stack direction="row" spacing={2.5} sx={{ mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
      {rows.map(({ key, Icon, color, text }) => (
        <Stack key={key} direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
          <Icon fontSize="small" sx={{ color }} />
          <Typography variant="body2" color="text.secondary">
            {text}
          </Typography>
        </Stack>
      ))}
    </Stack>
  );
}

import AirIcon from '@mui/icons-material/Air';
import CloudQueueIcon from '@mui/icons-material/CloudQueue';
import GrainIcon from '@mui/icons-material/Grain';
import LightModeIcon from '@mui/icons-material/LightMode';
import NightsStayIcon from '@mui/icons-material/NightsStay';
import ThermostatIcon from '@mui/icons-material/Thermostat';
import WaterDropIcon from '@mui/icons-material/WaterDrop';
import WavesIcon from '@mui/icons-material/Waves';
import Link from '@mui/material/Link';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import type { SxProps, Theme } from '@mui/material/styles';
import type { SvgIconProps } from '@mui/material/SvgIcon';
import Typography from '@mui/material/Typography';
import { type ComponentType, type ReactNode } from 'react';

import { getMoonPhase } from '../../model/moonPhase';
import type { Day } from '../../model/types';
import { aqiBand, CLOUD_COLOR, RAIN_COLOR, temperatureColor } from '../../model/weatherColors';
import { useDayWeather } from './useDayWeather';
import { useInViewport } from './useInViewport';
import { usePlaceWeatherLink } from './usePlaceWeatherLink';

type IconComponent = ComponentType<SvgIconProps>;

const SUNRISE_COLOR = '#f9a825'; // warm gold
const SUNSET_COLOR = '#5c6bc0'; // dusk indigo
const MOON_COLOR = '#9575cd'; // night-sky violet — distinct from SUNSET_COLOR's indigo
const WIND_COLOR = '#00897b'; // breeze teal
const WAVE_COLOR = '#0277bd'; // ocean blue — distinct from WIND_COLOR's teal and SUNSET_COLOR's indigo

// A tappable Weather-app deep link wrapping content when one resolved,
// rendered plain otherwise — the same optional-link shape every weather/
// elevation reading on the site can have (see PlaceConditionsLine, which
// shows this at a smaller scale).
export function WeatherLink({
  href,
  sx,
  children,
}: {
  href?: string | null;
  sx?: SxProps<Theme>;
  children: ReactNode;
}) {
  if (!href) return <>{children}</>;
  return (
    <Link
      href={href}
      target="_blank"
      rel="noopener"
      sx={{ color: 'inherit', textDecoration: 'none', ...sx }}
    >
      {children}
    </Link>
  );
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
  // Exactly one of Icon/emoji is set — MUI's icon set has no moon-phase
  // glyphs (only a generic sun/stars pair, already used for sunrise/sunset),
  // so the moon row renders its phase's actual emoji instead of a colored
  // SvgIcon.
  Icon?: IconComponent;
  emoji?: string;
  color: string;
  text: string;
  // A tappable deep link into the Weather app for that reading's place (see
  // weatherLink.ts) — null for a row with no place behind it (the moon
  // phase) or whose link hasn't resolved yet.
  href?: string | null;
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
  const sunriseHref = usePlaceWeatherLink(inView ? day.sunrisePlaceId : null);
  const sunsetHref = usePlaceWeatherLink(inView ? day.sunsetPlaceId : null);
  const weatherHref = usePlaceWeatherLink(inView ? day.weatherPlaceId : null);
  const aqiHref = usePlaceWeatherLink(inView ? airQualityPlaceId : null);
  const marineHref = usePlaceWeatherLink(inView ? marinePlaceId : null);

  if (!hasAnyPlace || failed) return null;

  if (!inView || loading || !weather) {
    return <Skeleton ref={ref} variant="text" width={220} sx={{ mb: 1.5 }} />;
  }

  const rows: WeatherRow[] = [];
  if (weather.sunrise) {
    rows.push({
      key: 'sunrise',
      Icon: LightModeIcon,
      color: SUNRISE_COLOR,
      text: weather.sunrise,
      href: sunriseHref,
    });
  }
  if (weather.sunset) {
    rows.push({
      key: 'sunset',
      Icon: NightsStayIcon,
      color: SUNSET_COLOR,
      text: weather.sunset,
      href: sunsetHref,
    });
  }
  const moon = getMoonPhase(day.date);
  rows.push({ key: 'moon', emoji: moon.emoji, color: MOON_COLOR, text: moon.name });
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
      color: WIND_COLOR,
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
      color: WAVE_COLOR,
      text: `${weather.waveHeightFt} ft seas`,
      href: marineHref,
    });
  }

  return (
    <Stack direction="row" spacing={2.5} sx={{ mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
      {rows.map(({ key, Icon, emoji, color, text, href }) => {
        const content = (
          <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
            {Icon ? (
              <Icon fontSize="small" sx={{ color }} />
            ) : (
              <Typography sx={{ fontSize: '1.1rem', lineHeight: 1 }}>{emoji}</Typography>
            )}
            <Typography variant="body2" color="text.secondary">
              {text}
            </Typography>
          </Stack>
        );
        return (
          <WeatherLink key={key} href={href}>
            {content}
          </WeatherLink>
        );
      })}
    </Stack>
  );
}

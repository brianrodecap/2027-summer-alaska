// Live sunrise/sunset + high/low temperature + cloud cover/precip chance/
// wind + air quality + (cruise-leg) marine conditions for a Day — resolved
// at render time from the Google Place ids Day.{sunrisePlaceId,
// sunsetPlaceId,weatherPlaceId} already carry plus whatever place the
// caller resolves for air quality/marine, using Open-Meteo (free, keyless,
// CORS-enabled — three separate API hosts: forecast/archive, air-quality,
// and marine, each with its own rate limit). Deliberately never written
// back into the trip's own JSON: unlike stays.json/activities.json this is
// refetched from scratch on every visit, so it's only ever as of whenever
// the site happens to be opened, never baked in as of whenever this code
// shipped.
import { fetchPlaceFields, isPlacesApiKeyConfigured } from './places';
import { formatTime, todayDateStr } from './tripModel';

export interface DayWeather {
  sunrise: string | null;
  sunset: string | null;
  highF: number | null;
  lowF: number | null;
  // true when this came from Open-Meteo's real short-range forecast (the
  // date fell inside its model window); false when it's a multi-year
  // climate average instead.
  isForecast: boolean;
  // Cloud cover / chance of rain / wind, at the same place highF/lowF came
  // from (whichever place the header title itself is about) — only ever a
  // real forecast value (isForecast true); null on the climate-average path,
  // since these three are too day-to-day variable for a multi-year average
  // to mean anything (see averageForMonthDay's own note).
  cloudCoverPct: number | null;
  precipProbabilityPct: number | null;
  windMph: number | null;
  // US AQI (0-500+) at whichever place the caller resolves for air quality —
  // null outside the air quality model's own (shorter) forecast window, since
  // there's no meaningful "average AQI" the way there's an average high/low.
  aqi: number | null;
  // Max wave height (feet) for a cruise-leg day — null for every other day,
  // since callers only ever pass a marine place id for days aboard the ship.
  waveHeightFt: number | null;
}

// The richer, forecast-request-shaped result for one place+date — sunrise,
// sunset, high/low temperature, and cloud/precip/wind all ride on the same
// Open-Meteo request (or, on the climate path, the same archive request),
// so this internal shape is fetched/cached once per place+date and
// getPlaceWeather reads whichever fields getDayWeather ends up needing off
// it (all of them, sourced from whichever of sunrise/sunset/weatherPlaceId
// each field is supposed to follow).
interface PlaceForecast {
  sunrise: string | null;
  sunset: string | null;
  highF: number | null;
  lowF: number | null;
  isForecast: boolean;
  cloudCoverPct: number | null;
  precipProbabilityPct: number | null;
  windMph: number | null;
}

interface Coordinates {
  lat: number;
  lng: number;
}

// Open-Meteo's forecast model only covers a rolling window from today —
// this must match what the trip actually means by "the 10-day forecast".
const FORECAST_WINDOW_DAYS = 10;
// Kept short on purpose: this is an average, not a record, so 5 years is
// plenty to smooth out a single unusual year while keeping the archive
// requests (and the localStorage entry they're persisted into) a fraction
// of the size a multi-decade pull would be.
const CLIMATE_YEARS = 5;
// How far (in days) either side of the target calendar date each year's
// archive window reaches, and how far either side averageForMonthDay will
// later accept a match from — see the chat message alongside this file for
// the trade-off this width encodes.
const CLIMATE_WINDOW_DAYS = 3;

const CACHE_VERSION = 'v3';

// Wraps localStorage so a lookup already resolved on a previous visit
// doesn't cost a network round-trip at all, not even a cached-but-still-async
// one — coordinates and climate history are looked up once per place here
// and read back synchronously-ish (still a Promise, but already resolved)
// on every later visit. Swallows quota/availability errors (Safari private
// browsing throws on write) since this is purely an optimization: losing it
// just means falling back to the in-memory-only behavior for that session.
function loadPersisted<T>(key: string, maxAgeMs: number): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { value, savedAt } = JSON.parse(raw) as { value: T; savedAt: number };
    if (Date.now() - savedAt > maxAgeMs) return null;
    return value;
  } catch {
    return null;
  }
}

function savePersisted<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ value, savedAt: Date.now() }));
  } catch {
    // best-effort — see loadPersisted's note above
  }
}

// Get-or-compute-and-cache the in-flight/resolved promise for `key` — the
// one "cache by key, store the promise" shape every lookup below shares
// (coordinates, forecasts, climate averages, air quality), so a repeat
// lookup within one page load never re-fires the underlying fetch.
function memoizeAsync<K, V>(
  cache: Map<K, Promise<V>>,
  key: K,
  compute: () => Promise<V>,
): Promise<V> {
  if (!cache.has(key)) cache.set(key, compute());
  return cache.get(key) as Promise<V>;
}

// Layers loadPersisted/savePersisted around a compute function — shared by
// the two lookups (coordinates, climate averages) that are also worth
// surviving a page reload, not just deduping within one.
function persisted<T>(storageKey: string, ttlMs: number, compute: () => Promise<T>): Promise<T> {
  const cached = loadPersisted<T>(storageKey, ttlMs);
  if (cached !== null) return Promise.resolve(cached);
  return compute().then((value) => {
    savePersisted(storageKey, value);
    return value;
  });
}

// Place coordinates never change, so once persisted they're reused forever
// (well, until CACHE_VERSION bumps) rather than expiring on a timer.
const COORDINATE_CACHE_TTL_MS = Infinity;
// Climate history shifts slowly — a month is a comfortable margin against
// re-pulling the whole archive every single session, while still picking up
// each new year's data reasonably promptly after it rolls in.
const CLIMATE_CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const coordinateCache = new Map<string, Promise<Coordinates>>();

async function fetchCoordinates(placeId: string): Promise<Coordinates> {
  const { location } = await fetchPlaceFields<{
    location: { latitude: number; longitude: number };
  }>(placeId, 'location');
  return { lat: location.latitude, lng: location.longitude };
}

// Cached by place id, same pattern as places.ts's own getPlace — a Stay
// spanning several nights (or a Transit's endpoint reused day to day) would
// otherwise re-resolve the same place's coordinates on every one of those days.
// Also persisted to localStorage so a repeat visit skips the Places API call
// entirely rather than just deduping within one page load.
function getCoordinates(placeId: string): Promise<Coordinates> {
  const storageKey = `weather-coords:${CACHE_VERSION}:${placeId}`;
  return memoizeAsync(coordinateCache, placeId, () =>
    persisted(storageKey, COORDINATE_CACHE_TTL_MS, () => fetchCoordinates(placeId)),
  );
}

// Whole-day difference between `date` and the real wall-clock "today" (via
// tripModel's own todayDateStr, so this shares one definition of "today"
// with the rest of the app rather than re-deriving it), computed via
// Date.UTC on the date-only parts (never local Date parsing of an ISO
// string) so a viewer's own timezone can't shift the day boundary.
function daysFromToday(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const [ty, tm, td] = todayDateStr().split('-').map(Number);
  return Math.round((Date.UTC(y, m - 1, d) - Date.UTC(ty, tm - 1, td)) / 86_400_000);
}

interface DailyBlock {
  time: string[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  sunrise: string[];
  sunset: string[];
  // Only present on the widened forecast request (fetchForecastDay) — the
  // climate archive request never asks for these, so they're optional here
  // rather than on a separate type, to keep one shape for both.
  cloud_cover_mean?: number[];
  precipitation_probability_max?: number[];
  wind_speed_10m_max?: number[];
}

// Open-Meteo's free tier rate-limits bursts of concurrent requests — an
// unvirtualized day list can easily resolve several dozen distinct places at
// once (every Stay/Transit endpoint, plus every priority Activity's own
// place now that the temperature follows the header title), which trips a
// 429 on its own well before that many places finish. Every call funnels
// through this queue — one request in flight at a time, each spaced at
// least MIN_DISPATCH_INTERVAL_MS after the previous one *started* — with a
// backoff retry on 429 as a fallback, rather than each Day firing its own
// fetch the moment it renders. Concurrency alone (running N at once) still
// lets a burst of N hit the API in the same instant; the spacing is what
// actually paces the request *rate*, which is what Open-Meteo enforces.
const MAX_CONCURRENT_OPEN_METEO_REQUESTS = 1;
const MIN_DISPATCH_INTERVAL_MS = 300;
let activeOpenMeteoRequests = 0;
let lastDispatchAt = 0;
const openMeteoQueue: (() => void)[] = [];

function runQueued<T>(task: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const run = () => {
      const wait = Math.max(0, lastDispatchAt + MIN_DISPATCH_INTERVAL_MS - Date.now());
      lastDispatchAt = Date.now() + wait;
      activeOpenMeteoRequests++;
      setTimeout(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            activeOpenMeteoRequests--;
            openMeteoQueue.shift()?.();
          });
      }, wait);
    };
    if (activeOpenMeteoRequests < MAX_CONCURRENT_OPEN_METEO_REQUESTS) run();
    else openMeteoQueue.push(run);
  });
}

// A 429 from Open-Meteo means two different things, and only one of them is
// worth retrying. A *minutely* burst limit is exactly what the queue above
// already exists to ride out — a short backoff and another attempt is likely
// to succeed. An *hourly*/*daily* quota is a wall that doesn't move no
// matter how many times it's asked; retrying just spends the backoff budget
// hammering an API that's already refusing everyone, and — worse — every
// other viewport-triggered place lookup hits the same wall independently
// and repeats the whole retry ladder on its own. quotaCooldownMs reads the
// API's own `reason` text to tell the two apart: null means "transient,
// let the retry loop below handle it"; a duration means "stop calling
// Open-Meteo altogether until this much time has passed."
//
// TODO(you): tune this. The API's wording ("...try again in the next
// hour") suggests waiting until the top of the next hour would minimize
// wasted calls once the real quota resets — but that requires trusting
// Open-Meteo's window boundary lines up with wall-clock hours, which isn't
// documented. A flat cooldown is simpler and recovers on a schedule we
// control, at the cost of possibly still being blocked (or leaving quota
// unused) when it expires. Below is a placeholder flat 60-minute cooldown
// for both hourly and daily reasons — worth reconsidering once real usage
// shows how often this actually trips.
const QUOTA_COOLDOWN_MS = 60 * 60 * 1000;

function quotaCooldownMs(reason: string): number | null {
  if (!/request limit exceeded/i.test(reason)) return null;
  return QUOTA_COOLDOWN_MS;
}

let quotaBlockedUntil = 0;

// Raw-JSON fetch/retry/cooldown, shared by every Open-Meteo-family host
// (forecast/archive, air-quality, marine) — each has its own rate limit, but
// they all speak the same "429, or a JSON body with an `error`/`reason`"
// shape, so one retry ladder and one quota-cooldown check covers all three.
async function fetchOpenMeteoJsonWithRetry(url: string, attempt = 0): Promise<unknown> {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if ((json as { error?: boolean } | null)?.error) {
    const cooldown = quotaCooldownMs((json as { reason?: string }).reason ?? '');
    if (cooldown !== null) {
      quotaBlockedUntil = Date.now() + cooldown;
      return null;
    }
    if (attempt < 9) {
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * 2 ** attempt, 20_000)));
      return fetchOpenMeteoJsonWithRetry(url, attempt + 1);
    }
    return null;
  }
  if (!res.ok) throw new Error(`Open-Meteo error ${res.status}`);
  return json;
}

function fetchOpenMeteoJson(url: string): Promise<unknown> {
  if (Date.now() < quotaBlockedUntil) return Promise.resolve(null);
  return runQueued(() => fetchOpenMeteoJsonWithRetry(url));
}

// Every Open-Meteo daily-block response (forecast, archive, marine) nests
// its arrays under `.daily` the same way — generic over which fields a
// particular request actually asked for.
function fetchOpenMeteoDaily<T extends { time: string[] }>(url: string): Promise<T | null> {
  return fetchOpenMeteoJson(url).then((json) => {
    const daily = (json as { daily?: T } | null)?.daily;
    return daily?.time?.length ? daily : null;
  });
}

// Keyed on place + date, not just place — unlike coordinates/climate, a
// forecast is only ever right for the one date it was fetched for. Kept
// in-memory only (no localStorage): the forecast for a given date changes
// as the date approaches, so persisting it across visits would risk
// serving a stale forecast instead of just re-fetching a cheap single day.
// This still dedupes the repeat calls that happen within one page load —
// remounts, StrictMode's double-invoke, a multi-night Stay reusing the
// same place on adjacent days.
const forecastCache = new Map<string, Promise<PlaceForecast | null>>();

// A real short-range forecast, only valid for dates inside Open-Meteo's
// model window (today..+9 days) — a 2027 trip date won't hit this path
// until the site is opened within ~10 days of that date actually arriving.
// Requests cloud cover/precip chance/wind alongside temperature/sunrise/
// sunset in the same call, since getPlaceWeather/getDayWeather want all of
// them together for the same place+date anyway.
function fetchForecastDay({ lat, lng }: Coordinates, date: string): Promise<PlaceForecast | null> {
  const key = `${lat.toFixed(2)},${lng.toFixed(2)}|${date}`;
  return memoizeAsync(forecastCache, key, () => {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lng}` +
      `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset,cloud_cover_mean,precipitation_probability_max,wind_speed_10m_max` +
      `&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=auto&start_date=${date}&end_date=${date}`;
    return fetchOpenMeteoDaily<DailyBlock>(url).then((daily) => {
      if (!daily) return null;
      return {
        sunrise: formatTime(daily.sunrise[0]),
        sunset: formatTime(daily.sunset[0]),
        highF: Math.round(daily.temperature_2m_max[0]),
        lowF: Math.round(daily.temperature_2m_min[0]),
        isForecast: true,
        cloudCoverPct: daily.cloud_cover_mean?.[0] ?? null,
        precipProbabilityPct: daily.precipitation_probability_max?.[0] ?? null,
        windMph:
          daily.wind_speed_10m_max?.[0] != null ? Math.round(daily.wind_speed_10m_max[0]) : null,
      };
    });
  });
}

interface ClimateDay {
  monthDay: string; // 'MM-DD'
  highF: number;
  lowF: number;
  sunrise: string;
  sunset: string;
}

const climateCache = new Map<string, Promise<ClimateDay[]>>();

// Adds `offsetDays` to a given year's occurrence of `monthDay` ('MM-DD'),
// returning the result as an ISO date — used to build each year's narrow
// archive window below. Deliberately allowed to cross into the adjacent
// calendar year (a target date in early January subtracts into December of
// the prior year): Open-Meteo's archive API just wants a valid contiguous
// start/end pair, not a range confined to one year.
function shiftMonthDayInYear(year: number, monthDay: string, offsetDays: number): string {
  const [mm, dd] = monthDay.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, mm - 1, dd) + offsetDays * 86_400_000);
  return shifted.toISOString().slice(0, 10);
}

// One archive request *per year*, each narrowed to just the ±CLIMATE_WINDOW_
// DAYS window around that year's occurrence of the target date — not one
// request spanning all CLIMATE_YEARS full years. Open-Meteo's archive API
// takes a single contiguous date range, so "the days near this date, in each
// of the last 5 years" can't be expressed as one call; it's either this (5
// small requests) or 1 request for entire years, most of which
// averageForMonthDay would immediately throw away. Given every Open-Meteo
// call already funnels through the paced single-request queue above, 5 small
// requests beat 1 request carrying ~50x the data neither getPlaceWeather nor
// averageForMonthDay ever reads.
//
// Deliberately only asks for temperature/sunrise/sunset here, never cloud
// cover/precip/wind — those three are far noisier day to day than a high/low
// range is, so a same-week-across-5-years average of them wouldn't describe
// "what to expect," just blur five unrelated weather systems together. See
// averageForMonthDay's own note on why those three stay forecast-only.
async function fetchClimateYears(
  { lat, lng }: Coordinates,
  monthDay: string,
): Promise<ClimateDay[]> {
  const endYear = new Date().getUTCFullYear() - 1;
  const startYear = endYear - (CLIMATE_YEARS - 1);
  const years = Array.from({ length: CLIMATE_YEARS }, (_, i) => startYear + i);
  const perYear = await Promise.all(
    years.map(async (year) => {
      const start = shiftMonthDayInYear(year, monthDay, -CLIMATE_WINDOW_DAYS);
      const end = shiftMonthDayInYear(year, monthDay, CLIMATE_WINDOW_DAYS);
      const url =
        `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lng}` +
        `&start_date=${start}&end_date=${end}` +
        `&daily=temperature_2m_max,temperature_2m_min,sunrise,sunset` +
        `&temperature_unit=fahrenheit&timezone=auto`;
      const daily = await fetchOpenMeteoDaily<DailyBlock>(url);
      if (!daily) return [];
      return daily.time.map((date, i) => ({
        monthDay: date.slice(5),
        highF: daily.temperature_2m_max[i],
        lowF: daily.temperature_2m_min[i],
        sunrise: daily.sunrise[i],
        sunset: daily.sunset[i],
      }));
    }),
  );
  return perYear.flat();
}

function getClimateYears(coords: Coordinates, monthDay: string): Promise<ClimateDay[]> {
  const key = `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}|${monthDay}`;
  // CLIMATE_YEARS and CLIMATE_WINDOW_DAYS are folded into the storage key so
  // that changing either invalidates old entries automatically instead of
  // serving a stale-shaped average under the new settings.
  const storageKey = `weather-climate:${CACHE_VERSION}:${key}:${CLIMATE_YEARS}:${CLIMATE_WINDOW_DAYS}`;
  return memoizeAsync(climateCache, key, () =>
    persisted(storageKey, CLIMATE_CACHE_TTL_MS, () => fetchClimateYears(coords, monthDay)),
  );
}

function averageForMonthDay(years: ClimateDay[], monthDay: string): PlaceForecast | null {
  if (!years.length) return null;
  const [mm, dd] = monthDay.split('-').map(Number);
  const target = Date.UTC(2001, mm - 1, dd); // arbitrary non-leap reference year
  const matches = years.filter((y) => {
    const [ym, yd] = y.monthDay.split('-').map(Number);
    const yearDate = Date.UTC(2001, ym - 1, yd);
    const diff = Math.abs(yearDate - target) / 86_400_000;
    return Math.min(diff, 365 - diff) <= CLIMATE_WINDOW_DAYS;
  });
  if (!matches.length) return null;
  const average = (nums: number[]) => nums.reduce((a, b) => a + b, 0) / nums.length;
  // Sunrise/sunset barely drift year to year for the same calendar date, so
  // one representative year (the exact date if one of the matches is it) is
  // used rather than averaged.
  const exact = matches.find((y) => y.monthDay === monthDay) ?? matches[0];
  return {
    highF: Math.round(average(matches.map((y) => y.highF))),
    lowF: Math.round(average(matches.map((y) => y.lowF))),
    sunrise: formatTime(exact.sunrise),
    sunset: formatTime(exact.sunset),
    isForecast: false,
    // Cloud cover/rain/wind stay null on the climate-average path on
    // purpose — a high/low range still describes something real about a
    // date ("typically 60s/40s"), but day-to-day cloud cover, whether it
    // rains, and wind speed swing far more than temperature does, so
    // averaging them across a handful of unrelated years wouldn't describe
    // anything a reader could actually plan around. Only Open-Meteo's real
    // forecast (fetchForecastDay, within FORECAST_WINDOW_DAYS) ever answers
    // these three.
    cloudCoverPct: null,
    precipProbabilityPct: null,
    windMph: null,
  };
}

// Sunrise/sunset/high/low for one specific place — the sunrise, sunset, and
// high/low temperature shown for a Day can each come from a *different*
// place (see DayWeatherPlaces below), so this resolves just one of them;
// getDayWeather composes the three.
async function getPlaceWeather(placeId: string, date: string): Promise<PlaceForecast | null> {
  const coords = await getCoordinates(placeId);
  if (daysFromToday(date) >= 0 && daysFromToday(date) < FORECAST_WINDOW_DAYS) {
    const forecast = await fetchForecastDay(coords, date);
    if (forecast) return forecast;
  }
  const monthDay = date.slice(5);
  const years = await getClimateYears(coords, monthDay);
  return averageForMonthDay(years, monthDay);
}

// ---- air quality — US AQI, for every day the caller resolves a place for
// (see DayWeatherStrip's own "best-effort place" fallback for days with no
// dedicated weatherPlaceId). Open-Meteo's air-quality model's own forecast
// horizon is shorter and less precisely documented than the main weather
// forecast's, so this is deliberately conservative about how far out it'll
// answer — see AIR_QUALITY_FORECAST_WINDOW_DAYS. ----------

// Open-Meteo doesn't document an exact air-quality forecast horizon the way
// the main weather forecast's ~16-day window is documented; 7 days is a
// conservative assumption based on the CAMS global model's typical
// published range. No climate-average fallback exists for this one at
// all — a smoke/dust event is inherently day-specific, so an "average AQI"
// would be actively misleading rather than just imprecise.
const AIR_QUALITY_FORECAST_WINDOW_DAYS = 7;
const airQualityCache = new Map<string, Promise<number | null>>();

async function fetchAirQuality(coords: Coordinates, date: string): Promise<number | null> {
  const key = `${coords.lat.toFixed(2)},${coords.lng.toFixed(2)}|${date}`;
  return memoizeAsync(airQualityCache, key, () => {
    const url =
      `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${coords.lat}&longitude=${coords.lng}` +
      `&hourly=us_aqi&timezone=auto&start_date=${date}&end_date=${date}`;
    return fetchOpenMeteoJson(url).then((json) => {
      const values = (json as { hourly?: { us_aqi?: (number | null)[] } } | null)?.hourly?.us_aqi;
      const valid = (values ?? []).filter((v): v is number => v !== null);
      return valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
    });
  });
}

async function getAirQuality(placeId: string | null, date: string): Promise<number | null> {
  if (!placeId || !isPlacesApiKeyConfigured()) return null;
  if (daysFromToday(date) < 0 || daysFromToday(date) >= AIR_QUALITY_FORECAST_WINDOW_DAYS)
    return null;
  const coords = await getCoordinates(placeId);
  return fetchAirQuality(coords, date);
}

// ---- marine conditions — max wave height, for a cruise-leg day only (the
// caller passes a marine place id solely on days aboard the ship — see
// DayWeatherStrip's cruise-day check). No climate-average fallback: wave
// height climatology isn't something Open-Meteo's marine archive exposes in
// the same reusable "one decade, filtered to nearby calendar days" shape the
// land climate archive does, and a single-day forecast is the whole point
// here (is it going to be rough the day we're crossing the Gulf of Alaska),
// not a typical-July average. ----------

interface MarineDailyBlock {
  time: string[];
  wave_height_max: number[];
}

const MARINE_FORECAST_WINDOW_DAYS = FORECAST_WINDOW_DAYS;

async function getWaveHeightFt(placeId: string | null, date: string): Promise<number | null> {
  if (!placeId || !isPlacesApiKeyConfigured()) return null;
  if (daysFromToday(date) < 0 || daysFromToday(date) >= MARINE_FORECAST_WINDOW_DAYS) return null;
  const { lat, lng } = await getCoordinates(placeId);
  const url =
    `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lng}` +
    `&daily=wave_height_max&length_unit=imperial&timezone=auto&start_date=${date}&end_date=${date}`;
  const daily = await fetchOpenMeteoDaily<MarineDailyBlock>(url);
  if (!daily?.wave_height_max?.length) return null;
  return Math.round(daily.wave_height_max[0] * 10) / 10;
}

// The place ids a Day resolves for its weather strip (see Day's own
// field-level notes in model/types.ts for why sunrise/sunset/weather can
// differ): sunrise comes from wherever the day starts, sunset from wherever
// it ends, and the high/low temperature from whichever place the day's
// header title itself is about. airQualityPlaceId and marinePlaceId are
// resolved by the caller rather than here (DayWeatherStrip's own
// best-effort/cruise-day logic) — null suppresses that lookup entirely
// (used for "not in viewport yet" and "not a cruise day" alike).
export interface DayWeatherPlaces {
  sunrisePlaceId: string | null;
  sunsetPlaceId: string | null;
  weatherPlaceId: string | null;
  airQualityPlaceId: string | null;
  marinePlaceId: string | null;
}

export async function getDayWeather(
  places: DayWeatherPlaces,
  date: string,
): Promise<DayWeather | null> {
  if (!isPlacesApiKeyConfigured()) return null;
  const uniqueIds = [
    ...new Set(
      [places.sunrisePlaceId, places.sunsetPlaceId, places.weatherPlaceId].filter(
        (id): id is string => Boolean(id),
      ),
    ),
  ];
  if (!uniqueIds.length && !places.airQualityPlaceId && !places.marinePlaceId) return null;

  // One place's lookup failing (a place id the Places API can't resolve, or
  // an Open-Meteo request that exhausts its retries) shouldn't blank out the
  // other fields — allSettled lets each role degrade on its own rather than
  // one bad place taking the whole strip down with it. Air quality and
  // marine are separate API hosts entirely, so they're fetched alongside
  // (not gated behind) the sunrise/sunset/temperature places resolving.
  const resolved = new Map<string, PlaceForecast | null>();
  const [settled, aqi, marine] = await Promise.all([
    Promise.allSettled(uniqueIds.map(async (id) => [id, await getPlaceWeather(id, date)] as const)),
    getAirQuality(places.airQualityPlaceId, date),
    getWaveHeightFt(places.marinePlaceId, date),
  ]);
  for (const outcome of settled) {
    if (outcome.status === 'fulfilled') resolved.set(...outcome.value);
  }

  const sunriseWeather = places.sunrisePlaceId ? resolved.get(places.sunrisePlaceId) : null;
  const sunsetWeather = places.sunsetPlaceId ? resolved.get(places.sunsetPlaceId) : null;
  const tempWeather = places.weatherPlaceId ? resolved.get(places.weatherPlaceId) : null;
  if (!sunriseWeather && !sunsetWeather && !tempWeather && aqi === null && marine === null) {
    return null;
  }

  return {
    sunrise: sunriseWeather?.sunrise ?? null,
    sunset: sunsetWeather?.sunset ?? null,
    highF: tempWeather?.highF ?? null,
    lowF: tempWeather?.lowF ?? null,
    isForecast: tempWeather?.isForecast ?? false,
    cloudCoverPct: tempWeather?.cloudCoverPct ?? null,
    precipProbabilityPct: tempWeather?.precipProbabilityPct ?? null,
    windMph: tempWeather?.windMph ?? null,
    aqi,
    waveHeightFt: marine,
  };
}

// Shared low-level Open-Meteo request plumbing — queueing/pacing, 429
// retry, and quota-cooldown — used by every Open-Meteo-family call this site
// makes (weather.ts's forecast/archive/air-quality/marine hosts, elevation.ts's
// own forecast-shaped call for a place's ground elevation), so all of them
// share one request queue and one quota-cooldown state rather than each
// pacing itself independently and, between them, still exceeding Open-Meteo's
// per-IP limits.

// Open-Meteo's free tier rate-limits bursts of concurrent requests — an
// unvirtualized day list can easily resolve several dozen distinct places at
// once (every Stay/Transit endpoint, every priority Activity's own place, now
// also any place with weather/elevation toggled on), which trips a 429 on its
// own well before that many places finish. Every call funnels through this
// queue — one request in flight at a time, each spaced at least
// MIN_DISPATCH_INTERVAL_MS after the previous one *started* — with a backoff
// retry on 429 as a fallback, rather than each caller firing its own fetch
// the moment it renders. Concurrency alone (running N at once) still lets a
// burst of N hit the API in the same instant; the spacing is what actually
// paces the request *rate*, which is what Open-Meteo enforces.
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

// A 429 from Open-Meteo means one of three different things, and only two of
// them are worth a cooldown. A *minutely* burst limit is exactly what the
// queue above already exists to ride out — a short backoff and another
// attempt is likely to succeed within the same minute. An *hourly*/*daily*
// quota is a wall that doesn't move no matter how many times it's asked;
// retrying just spends the backoff budget hammering an API that's already
// refusing everyone, and — worse — every other viewport-triggered place
// lookup hits the same wall independently and repeats the whole retry
// ladder on its own.
//
// Confirmed against Open-Meteo's own server source (it's open source —
// Sources/App/Helper/Vapor/RateLimiter.swift): all three counters are reset
// by a callback that fires once a minute, clearing the minutely counter
// every time, the hourly counter when the wall-clock UTC time is within the
// first minute of an hour, and the daily counter within the first minute of
// UTC midnight. So these are fixed wall-clock windows, not rolling ones —
// cooldownForReason below waits for the real boundary (plus up to a minute
// of slack for that callback's own cadence) rather than guessing a flat
// duration. A minutely-only reason returns null so the retry loop below
// handles it — its own backoff comfortably clears 60s well before that
// ladder's 9 attempts run out.
function cooldownForReason(reason: string): number | null {
  const now = Date.now();
  const HOUR_MS = 60 * 60 * 1000;
  const DAY_MS = 24 * HOUR_MS;
  const SLACK_MS = 60 * 1000;
  if (/^Daily API request limit exceeded/i.test(reason)) {
    return DAY_MS - (now % DAY_MS) + SLACK_MS;
  }
  if (/^Hourly API request limit exceeded/i.test(reason)) {
    return HOUR_MS - (now % HOUR_MS) + SLACK_MS;
  }
  return null;
}

let quotaBlockedUntil = 0;

// Raw-JSON fetch/retry/cooldown, shared by every Open-Meteo-family host
// (forecast/archive, air-quality, marine) — each has its own rate limit, but
// they all speak the same "429, or a JSON body with an `error`/`reason`"
// shape, so one retry ladder and one quota-cooldown check covers all of them.
async function fetchOpenMeteoJsonWithRetry(url: string, attempt = 0): Promise<unknown> {
  const res = await fetch(url);
  const json = await res.json().catch(() => null);
  if ((json as { error?: boolean } | null)?.error) {
    const cooldown = cooldownForReason((json as { reason?: string }).reason ?? '');
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

export function fetchOpenMeteoJson(url: string): Promise<unknown> {
  if (Date.now() < quotaBlockedUntil) return Promise.resolve(null);
  return runQueued(() => fetchOpenMeteoJsonWithRetry(url));
}

// A deep link into Apple's Weather app for a place, for tapping any weather
// reading (DayWeatherStrip's own rows, PlaceConditionsLine's weather line).
// `weather://` accepts `lat`/`long` query params to open Weather scoped to
// that location, rather than whatever it was already showing.
import type { Coordinates } from './placeCoordinates';

export function weatherAppUrl({ lat, lng }: Coordinates): string {
  return `weather://?lat=${lat}&long=${lng}`;
}

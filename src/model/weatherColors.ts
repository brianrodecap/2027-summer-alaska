// Colors describing weather conditions, shared by DayWeatherStrip,
// PlaceConditionsLine, and DayAlertsBanner — kept in one pure module (rather
// than exported alongside the DayWeatherStrip component) so a palette tweak
// in one place can't silently desync from the others, and so the component
// file itself only exports components.

export const CLOUD_COLOR = '#78909c'; // overcast blue-grey
export const RAIN_COLOR = '#1e88e5'; // rain blue

// A fixed palette keyed to how a high actually feels, rather than one flat
// "weather" color for every day — a 42° glacier day and a 78° cruise-port
// day shouldn't read the same at a glance.
export function temperatureColor(highF: number): string {
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

export function aqiBand(aqi: number): { color: string; label: string } {
  return AQI_BANDS.find((band) => aqi <= band.max) ?? AQI_BANDS[AQI_BANDS.length - 1];
}

// Exported for DayAlertsBanner, which reuses this exact amber for its own
// Moderate severity — see AQI_BANDS' own worst-first-scale note above.
export const AQI_MODERATE_COLOR = AQI_BANDS.find((band) => band.label === 'Moderate')!.color;

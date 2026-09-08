import { useKeyedAsync } from '../../hooks/useKeyedAsync';
import { getHoliday, type Holiday } from '../../model/holidays';

// Same "key the last result by what it was fetched for" pattern as
// useDayWeather, just keyed on the date alone. `active` gates the fetch the
// same way useSunAnchoredTime/DayWeatherStrip gate on viewport visibility —
// the caller passes its own inView check through. A holiday lookup itself
// dedupes fine without gating (getHoliday resolves through getYearHolidays,
// memoized on `US:<year>`, so every day in a trip year shares one in-flight
// promise), but the state update it triggers still fires a re-render for
// every unvirtualized day block on mount if left ungated.
export function useDayHoliday(date: string, active: boolean): Holiday | null {
  const { value } = useKeyedAsync(date, active, getHoliday);
  return value;
}

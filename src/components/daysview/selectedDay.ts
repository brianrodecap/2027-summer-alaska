// The day the wide layout's single-day panel shows: the URL's date when the filters
// still show it, else the first day left. Null when no day is left.
export function selectedDayDate(dates: string[], urlDate: string | undefined): string | null {
  return urlDate && dates.includes(urlDate) ? urlDate : (dates[0] ?? null);
}

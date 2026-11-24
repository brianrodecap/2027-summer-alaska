import type { PreviewStep } from './routePlanner';

// Preview day: the selected plan's day played through, timed from when each place
// is visited (its order, in ms) and the stored drive times between them, so the
// clock agrees with the day list. The steps are the route preview's own
// (PreviewStep): the drive to a place, then the time spent there.

export interface DayPreviewStop {
  order: number; // when the visit happens, in ms
  stopMinutes: number; // how long the visit takes, at least
}

// `driveMinutes[i]` is the drive from stop i - 1 to stop i (none for the first, and
// 0 where nothing is driven: a flight, a stop that has not loaded). A stop is
// stayed at until it is time to leave for the next, and never less than its own
// length; a stop reached late is left at once.
export function dayPreviewSteps(stops: DayPreviewStop[], driveMinutes: number[]): PreviewStep[] {
  const steps: PreviewStep[] = [];
  let arrive = 0;
  stops.forEach((stop, i) => {
    const next = stops[i + 1];
    const drive = i === 0 ? 0 : (driveMinutes[i] ?? 0);
    let stay = stop.stopMinutes;
    if (next) {
      const nextDrive = driveMinutes[i + 1] ?? 0;
      const nextStart = (next.order - stops[0].order) / 60_000;
      stay = Math.max(stay, nextStart - nextDrive - arrive);
    }
    steps.push({ drive, stop: stay, place: i });
    arrive += stay + (next ? (driveMinutes[i + 1] ?? 0) : 0);
  });
  return steps;
}

// A time of day as the day list writes it ("9:30 am"): the instant read on `zone`.
export function dayClock(instant: number, zone: string | null): string {
  return new Date(instant)
    .toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      ...(zone ? { timeZone: zone } : { timeZone: 'UTC' }),
    })
    .replace(/\s/g, ' ')
    .toLowerCase();
}

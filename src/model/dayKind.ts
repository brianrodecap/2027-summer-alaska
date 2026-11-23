import { portCallsOn } from './tripModel';
import type { Day } from './types';

// What kind of day a live day is, from the data it already has; nothing is stored.
// The poster, its scene and its stamp all read this one answer.
export type DayKind = 'scenario' | 'port' | 'sea' | 'flight' | 'drive' | 'stay';

// When several hold, the first of these wins, never an array position:
//   scenario: the day has weather plans; each plan keeps its own drive or flight
//   port:     a cruise stop where guests go ashore (beats sea: the day is spent ashore)
//   sea:      a cruise that only cruises past (Hubbard Glacier, Glacier Bay)
//   flight:   a flight departs (beats a drive: the drive is getting to the plane)
//   drive:    a drive departs
//   stay:     none of the above
export function dayKind(
  day: Pick<Day, 'date' | 'scenarioTracks'> & {
    stays: Pick<Day['stays'][number], 'portCalls'>[];
    transits: Pick<Day['transits'][number], 'mode'>[];
  },
): DayKind {
  if (day.scenarioTracks.length > 0) return 'scenario';
  const calls = portCallsOn(day.stays, day.date);
  if (calls.some((call) => call.kind === 'port')) return 'port';
  if (calls.length > 0) return 'sea';
  if (day.transits.some((t) => t.mode === 'flight')) return 'flight';
  if (day.transits.some((t) => t.mode === 'drive')) return 'drive';
  return 'stay';
}

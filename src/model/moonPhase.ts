// Moon phase for a calendar date — unlike sunrise/sunset/temperature this
// needs no place/coordinates at all (the moon's phase is the same
// everywhere on Earth on a given date), so it's a pure calculation rather
// than anything routed through weather.ts's Open-Meteo plumbing.
//
// Reference new moon: 2000-01-06 18:14 UTC, a commonly cited epoch for this
// calculation. Synodic month length (new moon to new moon) is 29.53058867
// days on average — real months vary by a few hours around that, which is
// well within the ±1/16-of-a-cycle bucket width the 8-phase split below
// tolerates.
import { parseIsoDateUTC } from './isoDate';

const REFERENCE_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14);

const SYNODIC_MONTH_DAYS = 29.53058867;

export interface MoonPhase {
  name: string;
  emoji: string;
}

const PHASES: { name: string; emoji: string }[] = [
  { name: 'New Moon', emoji: '🌑' },
  { name: 'Waxing Crescent', emoji: '🌒' },
  { name: 'First Quarter', emoji: '🌓' },
  { name: 'Waxing Gibbous', emoji: '🌔' },
  { name: 'Full Moon', emoji: '🌕' },
  { name: 'Waning Gibbous', emoji: '🌖' },
  { name: 'Last Quarter', emoji: '🌗' },
  { name: 'Waning Crescent', emoji: '🌘' },
];

export function getMoonPhase(date: string): MoonPhase {
  const daysSinceReference = (parseIsoDateUTC(date) - REFERENCE_NEW_MOON_UTC) / 86_400_000;
  let cyclePosition = (daysSinceReference % SYNODIC_MONTH_DAYS) / SYNODIC_MONTH_DAYS;
  if (cyclePosition < 0) cyclePosition += 1;

  return PHASES[Math.round(cyclePosition * 8) % 8];
}

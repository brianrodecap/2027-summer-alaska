import { createContext } from 'react';

import type { Day, EnrichedTransit } from '../model/types';

// The trip's days as the reader is looking at them — rows, scenario tabs,
// header and map places for the current scenario picks, route tones and meal
// choices (see buildLiveDays). Shared by everything that shows a day's
// content: the day list, a leg's day list, the budget's per-day labels.
// Both are built on first read, not on provider mount, so a consumer that
// doesn't need them yet should read them late (after its own early return),
// not destructure them at the top of its render.
export interface LiveDaysValue {
  days: Day[];
  byDate: Map<string, Day>;
  // Every Transit with its live route walk and arrival — see liveDays.ts's
  // liveTransits.
  transitsById: ReadonlyMap<string, EnrichedTransit>;
}

export const LiveDaysContext = createContext<LiveDaysValue | null>(null);

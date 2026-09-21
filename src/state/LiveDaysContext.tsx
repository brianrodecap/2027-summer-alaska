import { type ReactNode, useEffect, useMemo } from 'react';

import { buildLiveDays, type LiveDayCache, type LiveSelections } from '../model/liveDays';
import type { Day, TripData, TripView } from '../model/types';
import { LiveDaysContext, type LiveDaysValue } from './LiveDaysContextObject';
import { useTripData } from './useTripData';
import {
  useMealOptionSelection,
  useRouteToneSelection,
  useScenarioSelection,
} from './useTripSelections';

// Per statically built view: what each date's live Day was last time, so a
// selection change that doesn't touch a date hands that date back as the very
// same object (DayAccordion is memoized on it). Keyed by the view because a
// new view means every frame is new anyway — nothing to reuse. Only ever
// WRITTEN from an effect (a committed render), never while rendering, so a
// render React discards (StrictMode's double invoke, an interrupted concurrent
// render) can't leak its Day identities into the next compute.
const lastLiveDays = new WeakMap<TripView, Map<string, LiveDayCache>>();

interface BuiltLiveDays {
  days: Day[];
  byDate: Map<string, Day>;
  cache: Map<string, LiveDayCache>;
}

// One (data, selections) worth of live days, computed the first time anyone
// asks. A plain class rather than a closure so the memoized result is an
// ordinary field on an object created during render, not a captured variable.
class LazyLiveDays {
  private built: BuiltLiveDays | null = null;

  constructor(
    readonly view: TripView | null,
    private readonly data: TripData | null,
    private readonly selections: LiveSelections,
  ) {}

  get isBuilt(): boolean {
    return this.built !== null;
  }

  get(): BuiltLiveDays {
    if (this.built) return this.built;
    if (!this.view || !this.data) {
      this.built = { days: [], byDate: new Map(), cache: new Map() };
    } else {
      const { days, cache } = buildLiveDays(
        this.view,
        this.data,
        this.selections,
        lastLiveDays.get(this.view),
      );
      this.built = { days, byDate: new Map(days.map((d) => [d.date, d])), cache };
    }
    return this.built;
  }
}

// Builds the live days once per (data, selections) for the whole trip page —
// but only when a consumer first reads them, so the Overview and Budget pages
// (which mostly don't show days) don't pay for a full timeline/layout build on
// load and after every edit. Must sit inside TripDataProvider and
// TripSelectionsProvider.
export function LiveDaysProvider({ children }: { children: ReactNode }) {
  const { view, data } = useTripData();
  const { scenarioPicks } = useScenarioSelection();
  const { routeTones } = useRouteToneSelection();
  const { mealOptionIndex } = useMealOptionSelection();

  const lazy = useMemo(
    () => new LazyLiveDays(view, data, { scenarioPicks, routeTones, mealOptionIndex }),
    [view, data, scenarioPicks, routeTones, mealOptionIndex],
  );

  useEffect(() => {
    if (lazy.view && lazy.isBuilt) lastLiveDays.set(lazy.view, lazy.get().cache);
  }, [lazy]);

  const value = useMemo<LiveDaysValue>(
    () => ({
      get days() {
        return lazy.get().days;
      },
      get byDate() {
        return lazy.get().byDate;
      },
    }),
    [lazy],
  );

  return <LiveDaysContext.Provider value={value}>{children}</LiveDaysContext.Provider>;
}

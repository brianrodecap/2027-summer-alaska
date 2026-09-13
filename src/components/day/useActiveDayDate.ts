import { useEffect, useState } from 'react';

// Scrollspy for "which Day block is the reader actually looking at right
// now" — drives DayMapSidebar, the single persistent map panel beside the
// day list: rather than a map per day (a live google.maps.Map instance for
// every one of DaysView's ~28+ unvirtualized day blocks at once), one map
// swaps to whichever day this hook says is active as the reader scrolls.
//
// Watches a thin horizontal band across the middle of the viewport (via
// rootMargin, not each day block's full height) rather than "is any part of
// this day visible at all" — a day block is almost always far taller than
// that band, so at most one (rarely two, only mid-transition) ever
// intersects it at a time, giving a stable "the day centered on screen"
// signal instead of "every day partially visible."
export function useActiveDayDate(dates: string[]): string | null {
  const [activeDate, setActiveDate] = useState<string | null>(null);

  useEffect(() => {
    if (dates.length === 0) return;
    const elements = dates
      .map((date) => document.getElementById(`day-${date}`))
      .filter((el): el is HTMLElement => el !== null);
    if (elements.length === 0) return;

    const dateByElement = new Map(elements.map((el, i) => [el, dates[i]]));
    const intersecting = new Set<HTMLElement>();

    // Among every day block currently crossing the band, the "active" one
    // is whichever sits closest to the band's own center — recomputed from
    // fresh geometry each time, rather than trusting entry order, since
    // IntersectionObserver doesn't promise entries arrive in visual order.
    const pickActive = () => {
      const viewportMid = window.innerHeight / 2;
      let best: HTMLElement | null = null;
      let bestDistance = Infinity;
      for (const el of intersecting) {
        const rect = el.getBoundingClientRect();
        const distance = Math.abs((rect.top + rect.bottom) / 2 - viewportMid);
        if (distance < bestDistance) {
          bestDistance = distance;
          best = el;
        }
      }
      if (best) setActiveDate(dateByElement.get(best) ?? null);
    };

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          if (entry.isIntersecting) intersecting.add(el);
          else intersecting.delete(el);
        }
        pickActive();
      },
      { rootMargin: '-45% 0px -45% 0px' },
    );
    elements.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
    // dates is a fresh array every render; the joined string is its stable
    // identity — this should only actually re-run when the set of visible
    // days changes (e.g. a filter toggle), not on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dates.join(',')]);

  return activeDate;
}

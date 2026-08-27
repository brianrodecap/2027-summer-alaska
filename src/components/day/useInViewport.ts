import { useEffect, useRef, useState } from 'react';

// Generic "has this element scrolled near the viewport yet" gate. DaysView
// renders every Day block unvirtualized (~28 for this trip), so anything
// that fires on mount — like DayWeatherStrip's weather lookup — would
// otherwise run for every day at once regardless of what's actually on
// screen. This defers that first render/fetch until the element is close to
// view, then latches `inView` true for good: the goal is to delay work that
// hasn't been seen yet, not to tear it down and redo it every time a day
// scrolls back off-screen, which would just turn scrolling itself into a
// re-fetch trigger.
export function useInViewport<T extends Element>(rootMargin = '600px 0px') {
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    if (inView) return;
    const el = ref.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setInView(true);
      },
      { rootMargin },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [inView, rootMargin]);

  return { ref, inView };
}

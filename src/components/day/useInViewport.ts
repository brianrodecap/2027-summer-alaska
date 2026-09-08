import { useCallback, useEffect, useState } from 'react';

// One IntersectionObserver per distinct rootMargin, shared across every
// useInViewport call site — DayTimeline's ActivityNode/AvatarOrDot now call
// this per row (100+ rows for a trip this size), and standing up that many
// separate IntersectionObserver instances on mount is wasted work an
// observer's own multi-target .observe() API already exists to avoid.
const sharedObservers = new Map<
  string,
  { observer: IntersectionObserver; callbacks: Map<Element, () => void> }
>();

function getSharedObserver(rootMargin: string) {
  let entry = sharedObservers.get(rootMargin);
  if (!entry) {
    const callbacks = new Map<Element, () => void>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) callbacks.get(entry.target)?.();
        }
      },
      { rootMargin },
    );
    entry = { observer, callbacks };
    sharedObservers.set(rootMargin, entry);
  }
  return entry;
}

// Generic "has this element scrolled near the viewport yet" gate. DaysView
// renders every Day block unvirtualized (~28 for this trip), so anything
// that fires on mount — like DayWeatherStrip's weather lookup — would
// otherwise run for every day at once regardless of what's actually on
// screen. This defers that first render/fetch until the element is close to
// view, then latches `inView` true for good: the goal is to delay work that
// hasn't been seen yet, not to tear it down and redo it every time a day
// scrolls back off-screen, which would just turn scrolling itself into a
// re-fetch trigger.
//
// `ref` is a callback ref (backed by state), not a plain useRef object —
// deliberately, so a caller that only conditionally renders the ref-bearing
// element (PlaceConditionsLine's Skeleton, gated behind a toggle that can
// flip on well after this hook's first render) still gets an observer set
// up once that element actually mounts. A plain useRef's effect would only
// ever see whatever ref.current held during the hook's very first render —
// null, in that case — and never re-check it, since a ref mutation alone
// doesn't retrigger an effect keyed on inView/rootMargin.
export function useInViewport<T extends Element>(rootMargin = '600px 0px') {
  const [element, setElement] = useState<T | null>(null);
  const [inView, setInView] = useState(false);
  const ref = useCallback((node: T | null) => setElement(node), []);

  useEffect(() => {
    if (inView || !element) return;
    const { observer, callbacks } = getSharedObserver(rootMargin);
    callbacks.set(element, () => setInView(true));
    observer.observe(element);
    return () => {
      observer.unobserve(element);
      callbacks.delete(element);
    };
  }, [element, inView, rootMargin]);

  return { ref, inView };
}

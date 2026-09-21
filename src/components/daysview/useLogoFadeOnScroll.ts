import { useEffect, useRef, useState } from 'react';

// A zero-height marker at the bar's own natural (pre-stick) position: once
// it has scrolled off the top, the trip hero above is gone and the bar is
// pinned, which is when the logo fades in to stand in for the hero. The
// opacity is written straight to the DOM rather than through state so a
// crossing doesn't re-render this whole (large) day list before the fade.
// Attach `sentinelRef` to the marker and `logoRef` to the logo image.
export function useLogoFadeOnScroll() {
  const [sentinel, sentinelRef] = useState<HTMLElement | null>(null);
  const logoRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!sentinel) return;
    const observer = new IntersectionObserver(([entry]) => {
      const heroGone = !entry.isIntersecting && entry.boundingClientRect.top < 0;
      if (logoRef.current) logoRef.current.style.opacity = heroGone ? '1' : '0';
    });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [sentinel]);
  return { sentinelRef, logoRef };
}

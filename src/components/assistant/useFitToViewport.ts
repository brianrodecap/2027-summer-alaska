import { useEffect, useRef, useState } from 'react';

// The height from an element's top edge to the bottom of the viewport, kept current as
// the page scrolls and resizes. The wide-screen sidebar is sticky at the top of the
// viewport but starts below the trip hero, so until the hero scrolls away the bottom
// of a 100vh sidebar sits below the fold — fine for the map, but it would hide the
// assistant's message box. Sizing the panel to this measurement keeps the box on
// screen at every scroll position. Returns null until measured (or when disabled),
// so callers can fall back to filling their container.
export function useFitToViewport<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const el = ref.current;
      if (!el) return;
      // Once the sidebar is stuck, `top` stops changing and React skips the re-render.
      setHeight(Math.round(window.innerHeight - Math.max(0, el.getBoundingClientRect().top)));
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      cancelAnimationFrame(frame);
    };
  }, [enabled]);

  return { ref, height: enabled ? height : null };
}

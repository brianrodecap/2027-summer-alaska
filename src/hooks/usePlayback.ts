import { useCallback, useEffect, useRef, useState } from 'react';

// A 0..1 position that plays forward over `durationMs` and stops at the end.
// Playing again from the end starts over; seeking pauses nothing by itself.
export function usePlayback(durationMs: number) {
  const at = useRef(0);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let frame = 0;
    const tick = (now: number) => {
      // a frame's own timestamp can be a moment before the one the loop started from
      at.current = Math.min(1, at.current + Math.max(0, now - last) / durationMs);
      last = now;
      setProgress(at.current);
      if (at.current >= 1) setPlaying(false);
      else frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, durationMs]);

  const seek = useCallback((to: number) => {
    at.current = to;
    setProgress(to);
  }, []);
  const play = useCallback(() => {
    if (at.current >= 1) seek(0);
    setPlaying(true);
  }, [seek]);
  const pause = useCallback(() => setPlaying(false), []);
  return { progress, playing, seek, play, pause };
}

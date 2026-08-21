import { useMemo, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from 'react';

export interface LongPressHandlers<T extends Element> {
  onPointerDown: (e: ReactPointerEvent<T>) => void;
  onPointerMove: (e: ReactPointerEvent<T>) => void;
  onPointerUp: (e: ReactPointerEvent<T>) => void;
  onPointerLeave: (e: ReactPointerEvent<T>) => void;
  // Spread onto the same element as the row's own onClick — swallows the
  // synthetic click a long-press's pointerup would otherwise still fire, so
  // a long press never also triggers the row's normal tap action.
  onClickCapture: (e: ReactMouseEvent<T>) => void;
}

const THRESHOLD_MS = 500;
const MOVE_TOLERANCE_PX = 10;

// TODO(you): this is the gesture that decides whether a press on a day-list
// row (Stay/Transit-Depart/Activity) was a normal tap — which should open
// that row's detail dialog via the row's own existing onClick, untouched —
// or a long press, which should instead pop the row's RowSpeedDial (Edit /
// Add alert / Add info / Add footnote). Both start on the same pointerdown,
// so there's no separate "long-press button" to hang this off of.
//
// firedRef below already does its job: onClickCapture swallows the click
// whenever firedRef.current is true. What's missing is setting it — fill in
// the four handlers so that:
//   - onPointerDown records the press start (position + a THRESHOLD_MS
//     timer). If the timer completes, that's a long press: call
//     onLongPress() and set firedRef.current = true.
//   - onPointerMove cancels the timer if the pointer has drifted more than
//     MOVE_TOLERANCE_PX from where it started (a scroll/drag, not a press).
//   - onPointerUp / onPointerLeave cancel the timer on an ordinary release
//     or the pointer leaving the element — that should read as a plain tap,
//     letting the browser's real click fire onClick as normal.
// Pointer Events already unify mouse and touch, so there's no separate
// touchstart/mousedown path to handle. Threshold/tolerance above are yours
// to retune once you've tried the feel.
export function useLongPress<T extends Element = Element>(onLongPress: () => void): LongPressHandlers<T> {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const firedRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    startRef.current = null;
  };

  return useMemo(
    () => ({
      onPointerDown: (_e: ReactPointerEvent<T>) => {
        void THRESHOLD_MS;
        // TODO(you): record _e.clientX/clientY in startRef, start the timer.
      },
      onPointerMove: (_e: ReactPointerEvent<T>) => {
        void MOVE_TOLERANCE_PX;
        // TODO(you): cancel the timer if the pointer moved too far.
      },
      onPointerUp: () => {
        clearTimer();
      },
      onPointerLeave: () => {
        clearTimer();
      },
      onClickCapture: (e: ReactMouseEvent<T>) => {
        if (firedRef.current) {
          e.preventDefault();
          e.stopPropagation();
          firedRef.current = false;
        }
      },
    }),
    [onLongPress],
  );
}

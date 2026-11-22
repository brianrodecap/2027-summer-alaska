import { createContext } from 'react';

import type { MoveMembers } from '../model/moveToDay';

export interface MoveToDayContextValue {
  // Opens the day picker for these entries (a plan group moves whole, see
  // MoveMembers); picking a day moves them there, and then `onMoved` runs.
  requestMove: (moves: MoveMembers[], onMoved?: () => void) => void;
}

export const MoveToDayContext = createContext<MoveToDayContextValue | null>(null);

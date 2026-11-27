import { createContext, useContext } from 'react';

export interface DayPins {
  numbers: ReadonlyMap<string, number>; // mapPinNumbers, by pinIds
  color: string;
}

export const DayPinsContext = createContext<DayPins>({ numbers: new Map(), color: '' });

export function useDayPin(pinId: string): { number: number | undefined; color: string } {
  const { numbers, color } = useContext(DayPinsContext);
  return { number: numbers.get(pinId), color };
}

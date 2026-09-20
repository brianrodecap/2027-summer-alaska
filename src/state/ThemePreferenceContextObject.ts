import { createContext } from 'react';

import type { ThemePreference } from '../config/themePreference';

export interface ThemePreferenceContextValue {
  preference: ThemePreference;
  setPreference: (preference: ThemePreference) => void;
}

export const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

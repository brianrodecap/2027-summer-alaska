import CssBaseline from '@mui/material/CssBaseline';
import { ThemeProvider } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import { type ReactNode, useCallback, useMemo, useState } from 'react';

import {
  getStoredThemePreference,
  setStoredThemePreference,
  type ThemePreference,
} from '../config/themePreference';
import { THEMES } from '../theme';
import { ThemePreferenceContext } from './ThemePreferenceContextObject';

// Owns the MUI ThemeProvider itself (rather than main.tsx doing it) because
// the theme is now a function of the user's saved preference: 'system'
// resolves live against prefers-color-scheme, so an OS-level switch while the
// site is open re-themes it without a reload.
export function ThemePreferenceProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<ThemePreference>(getStoredThemePreference);
  const systemPrefersDark = useMediaQuery('(prefers-color-scheme: dark)', {
    // Client-only SPA: read the OS setting on first render so a 'system' user on a
    // dark OS doesn't flash the light theme before the effect-driven update.
    noSsr: true,
  });

  const setPreference = useCallback((next: ThemePreference) => {
    setPreferenceState(next);
    setStoredThemePreference(next);
  }, []);

  const mode = preference === 'system' ? (systemPrefersDark ? 'dark' : 'light') : preference;
  const value = useMemo(() => ({ preference, setPreference }), [preference, setPreference]);

  return (
    <ThemePreferenceContext.Provider value={value}>
      <ThemeProvider theme={THEMES[mode]}>
        <CssBaseline />
        {children}
      </ThemeProvider>
    </ThemePreferenceContext.Provider>
  );
}

import { useRequiredContext } from './contextHook';
import {
  ThemePreferenceContext,
  type ThemePreferenceContextValue,
} from './ThemePreferenceContextObject';

export function useThemePreference(): ThemePreferenceContextValue {
  return useRequiredContext(
    ThemePreferenceContext,
    'useThemePreference must be used within a ThemePreferenceProvider',
  );
}

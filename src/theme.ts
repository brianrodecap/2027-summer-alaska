import { createTheme, type PaletteColor, type PaletteColorOptions } from '@mui/material/styles';

// Ported from the site's former Material Web `--md-sys-color-*` / `--md-sys-shape-corner-*`
// tokens (docs/styles.css) — the stock MD3 baseline ("Material You" purple) palette, not a
// custom brand color. MUI's PaletteColor has no MD3-style "container"/"on-container" pair
// built in, so it's added via module augmentation below to keep that same tone-pair concept
// (e.g. `.tone-ideal`/`.tone-alternate` mapping onto primary/error container roles).
declare module '@mui/material/styles' {
  interface PaletteColor {
    container: string;
    onContainer: string;
  }
  interface SimplePaletteColorOptions {
    container?: string;
    onContainer?: string;
  }
  interface Palette {
    tertiary: PaletteColor;
    surfaceContainer: {
      lowest: string;
      low: string;
      DEFAULT: string;
      high: string;
      highest: string;
    };
  }
  interface PaletteOptions {
    tertiary?: PaletteColorOptions & { container?: string; onContainer?: string };
    surfaceContainer?: {
      lowest: string;
      low: string;
      DEFAULT: string;
      high: string;
      highest: string;
    };
  }
}

export const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#6750a4',
      contrastText: '#ffffff',
      container: '#eaddff',
      onContainer: '#21005d',
    },
    secondary: {
      main: '#625b71',
      contrastText: '#ffffff',
      container: '#e8def8',
      onContainer: '#1d192b',
    },
    error: {
      main: '#b3261e',
      contrastText: '#ffffff',
      container: '#f9dedc',
      onContainer: '#410e0b',
    },
    tertiary: {
      main: '#7d5260',
      contrastText: '#ffffff',
      container: '#ffd8e4',
      onContainer: '#31111d',
    } as PaletteColor,
    background: {
      default: '#fffbfe',
      paper: '#f7f2fa',
    },
    text: {
      primary: '#1c1b1f',
      secondary: '#49454f',
    },
    divider: '#cac4d0',
    surfaceContainer: {
      lowest: '#ffffff',
      low: '#f7f2fa',
      DEFAULT: '#f3edf7',
      high: '#ece6f0',
      highest: '#e6e0e9',
    },
  },
  shape: {
    borderRadius: 12, // --md-sys-shape-corner-medium
  },
  typography: {
    fontFamily: "'Roboto Serif', serif",
  },
});

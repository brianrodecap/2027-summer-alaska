import { createTheme, type PaletteColor, type PaletteColorOptions } from '@mui/material/styles';

// Custom dark palette, landed on after exploring several directions: a Dorothy Waugh
// WPA national-park-poster combination (steel-blue / terracotta / mustard-gold), adapted to
// a dark ground rather than Waugh's original cream lithograph paper. Replaces the site's
// original stock MD3 "Material You" purple baseline. MUI's PaletteColor has no MD3-style
// "container"/"on-container" pair built in, so it's added via module augmentation below to
// keep that tone-pair idea — the alt scenario track uses `error` as its color (see
// ScenarioTabsSection's existing primary/error semantic mapping), so `error` below is the
// mustard-gold, not a literal warning red.
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
    mode: 'dark',
    primary: {
      main: '#3f6f9e',
      contrastText: '#eaf3fb',
      container: '#14263a',
      onContainer: '#cfe0f0',
    },
    secondary: {
      main: '#c96b48',
      contrastText: '#fff6f1',
      container: '#3d1f12',
      onContainer: '#f5d8c8',
    },
    error: {
      main: '#e0a83a',
      contrastText: '#2e2013',
      container: '#3d2e08',
      onContainer: '#fbe6b8',
    },
    tertiary: {
      main: '#c96b48',
      contrastText: '#fff6f1',
      container: '#3d1f12',
      onContainer: '#f5d8c8',
    } as PaletteColor,
    background: {
      default: '#1a140c',
      paper: '#221a10',
    },
    text: {
      primary: '#ece2cf',
      secondary: '#a89880',
    },
    divider: '#4a3d28',
    surfaceContainer: {
      lowest: '#120d08',
      low: '#1a140c',
      DEFAULT: '#201810',
      high: '#281f14',
      highest: '#332a1c',
    },
  },
  shape: {
    borderRadius: 12, // --md-sys-shape-corner-medium
  },
  typography: {
    fontFamily: "'Roboto Serif', serif",
  },
  components: {
    // Native <button>s opt out of font inheritance by default (the
    // browser's own UA stylesheet, not an MUI choice) — MUI's CssBaseline
    // resets html/body but never touches form controls, so every
    // ButtonBase-based component (Button, IconButton, a day-list row's own
    // clickable ButtonBase) silently falls back to the browser's default
    // Arial instead of this theme's Roboto Serif. Invisible where a button
    // only ever holds Typography children (which set their own explicit
    // font), but it skews the button's own layout metrics — e.g. it was
    // the real reason a day-list row's leading caption sat noticeably
    // closer to the timeline dot when the row happened to be a clickable
    // ButtonBase (Activity) than when it was a plain non-interactive Box
    // (Stay/Transit), even though both used identical Typography styling.
    MuiButtonBase: {
      styleOverrides: {
        root: {
          font: 'inherit',
        },
      },
    },
  },
});

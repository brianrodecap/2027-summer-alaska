import {
  createTheme,
  type PaletteColor,
  type PaletteColorOptions,
  type PaletteMode,
  type PaletteOptions,
  type Theme,
} from '@mui/material/styles';

// Custom dark palette, landed on after exploring several directions: a Dorothy Waugh
// WPA national-park-poster combination (steel-blue / terracotta / mustard-gold), adapted to
// a dark ground rather than Waugh's original cream lithograph paper. Replaces the site's
// original stock MD3 "Material You" purple baseline (the light palette further below is the
// same Waugh combination on its original cream lithograph paper). MUI's PaletteColor has no
// MD3-style "container"/"on-container" pair built in, so it's added via module augmentation
// below to keep that tone-pair idea — the alt scenario track uses `error` as its color (see
// ScenarioTabsSection's existing primary/error semantic mapping), so `error` below is the
// mustard-gold, not a literal warning red.
export interface ConditionsPalette {
  sunrise: string;
  sunset: string; // dusk indigo
  moon: string; // night-sky violet — distinct from sunset's indigo
  wind: string; // breeze teal
  wave: string; // ocean blue — distinct from wind's teal and sunset's indigo
  travel: string; // road brown — distinct from the weather colors above
  elevation: string; // terrain brown — distinct from every weather color
  alertExtreme: string; // NWS "Extreme": reds nothing else on the site uses,
  alertSevere: string; // since no other reading says "this can hurt someone"
}

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
    // Headline accent: every h4 (via `typography` below) plus day titles (an h6
    // override in DayHeader — a theme-wide h6 color would also reach every
    // DialogTitle). A brighter sibling of `error`'s mustard-gold, kept as its
    // own role so headline color isn't tied to the alt-scenario semantic that
    // `error` carries.
    gold: PaletteColor;
    surfaceContainer: {
      lowest: string;
      low: string;
      DEFAULT: string;
      high: string;
      highest: string;
    };
    // Fixed, domain-meaningful accents for the day list's live-conditions icons
    // (weather/travel/elevation chips) and the top severities of an NWS alert.
    // Not tied to primary/secondary/error's scenario semantics — each names what
    // the color *depicts* (sunrise gold, road brown), so each mode can tune its
    // own value where the other's would be illegible on its ground.
    conditions: ConditionsPalette;
  }
  interface PaletteOptions {
    tertiary?: PaletteColorOptions & { container?: string; onContainer?: string };
    gold?: PaletteColorOptions;
    conditions?: ConditionsPalette;
    surfaceContainer?: {
      lowest: string;
      low: string;
      DEFAULT: string;
      high: string;
      highest: string;
    };
  }
}

const DARK_SECONDARY = {
  main: '#c96b48',
  contrastText: '#fff6f1',
  container: '#3d1f12',
  onContainer: '#f5d8c8',
};

const DARK_PALETTE: PaletteOptions = {
  primary: {
    main: '#3f6f9e',
    contrastText: '#eaf3fb',
    container: '#14263a',
    onContainer: '#cfe0f0',
  },
  secondary: DARK_SECONDARY,
  error: {
    main: '#e0a83a',
    contrastText: '#2e2013',
    container: '#3d2e08',
    onContainer: '#fbe6b8',
  },
  tertiary: DARK_SECONDARY as PaletteColor,
  gold: {
    main: '#f2c14e',
  },
  conditions: {
    sunrise: '#f9a825',
    sunset: '#5c6bc0',
    moon: '#9575cd',
    wind: '#00897b',
    wave: '#0277bd',
    travel: '#6d4c41',
    elevation: '#8d6e63',
    alertExtreme: '#c62828',
    alertSevere: '#e64a19',
  },
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
};

// Cream-paper counterpart to DARK_PALETTE: same hue families (steel-blue primary,
// terracotta secondary, mustard `error`/`gold`) so scenario tracks and headlines keep their
// meaning across modes, but the mid-tone accents are deepened so text set in them
// (alt-scenario labels, day titles, h4 headlines) still reads on a light ground — the dark
// palette's brighter mustard would wash out on cream.
const LIGHT_SECONDARY = {
  main: '#b5562f',
  contrastText: '#ffffff',
  container: '#f6ddd0',
  onContainer: '#4a200e',
};

const LIGHT_PALETTE: PaletteOptions = {
  primary: {
    main: '#2f5f8f',
    contrastText: '#ffffff',
    container: '#d6e6f4',
    onContainer: '#12293f',
  },
  secondary: LIGHT_SECONDARY,
  error: {
    main: '#8a5f06',
    contrastText: '#ffffff',
    container: '#fbe6b8',
    onContainer: '#3d2e08',
  },
  tertiary: LIGHT_SECONDARY as PaletteColor,
  gold: {
    main: '#96690a',
  },
  // Dark palette's accents, deepened where they'd wash out on cream.
  conditions: {
    sunrise: '#b26a00',
    sunset: '#3f4fa0',
    moon: '#6a4fb0',
    wind: '#00695c',
    wave: '#01579b',
    travel: '#6d4c41',
    elevation: '#7a5a4e',
    alertExtreme: '#b71c1c',
    alertSevere: '#c43e12',
  },
  background: {
    default: '#f6efe0',
    paper: '#fffaf0',
  },
  text: {
    primary: '#2b2216',
    secondary: '#6b5c44',
  },
  divider: '#dccfb4',
  surfaceContainer: {
    lowest: '#fffdf7',
    low: '#faf4e6',
    DEFAULT: '#f6efe0',
    high: '#efe6d1',
    highest: '#e8dcc2',
  },
};

const PALETTES: Record<PaletteMode, PaletteOptions> = {
  light: LIGHT_PALETTE,
  dark: DARK_PALETTE,
};

function buildTheme(mode: PaletteMode) {
  return createTheme({
    palette: { mode, ...PALETTES[mode] },
    shape: {
      borderRadius: 12, // --md-sys-shape-corner-medium
    },
    typography: (palette) => ({
      fontFamily: "'Roboto Serif', serif",
      h4: { color: palette.gold.main },
    }),
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
}

// Both themes are built once up front: the active one follows the user's color-mode
// preference (ThemePreferenceProvider), and the trip hero pins THEMES.dark under its
// photo overlay regardless of mode.
export const THEMES: Record<PaletteMode, Theme> = {
  light: buildTheme('light'),
  dark: buildTheme('dark'),
};

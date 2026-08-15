# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static itinerary site for a 2027 Alaska trip (national parks road/fly trip + a 7-night cruise), built entirely from real **Material Web Components** (`@material/web`, Google's MD3 component library) loaded buildless from a CDN — no framework, no bundler, no `npm install`. Everything under `docs/` is served as-is by GitHub Pages from `main`:

- `docs/index.html` — page shell: hero, sticky nav tabs, section containers, footnotes
- `docs/styles.css` — the M3 color/shape tokens plus the minimal structural CSS `@material/web` doesn't provide (see "Design system")
- `docs/days/day-<id>.js` — one file per day of the trip, each a plain ES module exporting that day's content as a data object. This is the single source of truth per day; nothing else duplicates it.
- `docs/days/index.js` — imports every `day-*.js` and exports them as one ordered `days` array
- `docs/js/day-render.js` — pure functions that turn a day's data into DOM: `renderListItem`, `renderSurfaceItem` (shared by the carousel and cards views), `renderDetailBody`
- `docs/js/side-sheet.js` — the `<detail-side-sheet>` custom element (the one non-content component in the codebase)
- `docs/js/app.js` — bootstraps everything: populates the List/Carousel/Cards sections and the date-jump menu from `days`, wires clicks to open the side sheet, drives the nav tabs

## Working with it

- Edit files directly; there is nothing to install or compile.
- Preview locally by serving `docs/` over HTTP, e.g. `python3 -m http.server 8934 --directory docs` then opening `http://localhost:8934/`. Opening `docs/index.html` directly via a `file://` URL does *not* work — browsers block ES module imports (`app.js`'s `import` statements) under CORS from the `file:` origin. The `@material/web` import map points at `https://esm.run/@material/web/`, so a network connection is required even for local preview.
- Roboto and Material Symbols Outlined are loaded from Google Fonts via `<link>` tags in `<head>` — no local font files.
- Pushing to `main` updates the live GitHub Pages site directly; there is no staging/preview environment.

## Content structure — adding or editing a day

Each day is one file in `docs/days/`, e.g. `day-jun27.js`:

```js
export default {
  id: 'jun27',
  dateLabel: 'Sun Jun 27',
  location: 'Talkeetna',
  hotel: 'Talkeetna Alaskan Lodge',
  restaurant: 'Denali Brewing Co.',
  summary: '<strong>Denali flightseeing</strong> day, weather permitting<sup><a href="#fn2">2</a></sup>.',
  notes: [ { icon: 'warning', html: '...' } ],   // optional callouts (road status, meal timing, risk flags)
  variants: [
    { tone: 'ideal', label: 'Ideal — flight goes', icon: 'flight_takeoff',
      items: [ { time: '8:00am', text: '...' }, ... ], footer: '<p>...</p>' },
    { tone: 'alternate', label: 'Alternate — flight weathered out', icon: 'cloud', items: [...] },
  ],
};
```

- `variants` is the ideal/alternate split for weather-dependent flightseeing days — the itinerary's real risk structure, not a cosmetic device. Days without a fixed hour-by-hour plan just leave `variants: []`, and the side sheet falls back to showing `summary`. A single-variant day (a plan with no go/no-go branch) omits `label`/`icon` and the chip is skipped.
- `summary`/`items[].text`/`notes[].html`/`footer` are raw HTML (footnote `<sup><a href="#fn...">`, `<strong>`, etc.) — safe here because it's all author-controlled static content, never user input.
- To add a new day: create `docs/days/day-<id>.js`, then add it to the `days` array in `docs/days/index.js` in itinerary order. It automatically appears in the List, Carousel, Cards, and date-jump menu — nothing else to touch.
- `#footnotes` in `index.html` is still hand-maintained; keep footnote numbers in sync with the `#fn<n>` references inside day files.

## Presentation: three views, a day dialog, and an activity side sheet

The same `days` data renders three ways, switched via the nav tabs — this is a deliberate exploration to compare presentations, not a permanent design decision:

1. **List** (`#view-list`) — an `md-list` of `md-list-item type="button"` rows
2. **Carousel** (`#view-carousel`) — a horizontally scrolling, scroll-snapped row of "day surface" items
3. **Cards** (`#view-cards`) — the same "day surface" items in a responsive grid

Navigation drills down two levels. Clicking any item in any view opens `#day-dialog` (a real `md-dialog`) with that day's full detail (hotel/restaurant, notes, ideal/alternate variant activity lists). Clicking an activity row inside the dialog closes the dialog and opens `<detail-side-sheet>` with that single activity's detail. The Overview tab's "Jump to a day" `md-menu` (date selector) opens the day dialog directly — this is explicitly a placeholder ("for now") pending a real navigation redesign once the three views have been compared.

## Design system

The site follows Google's **Material Design 3** spec directly, implemented with real `@material/web` components rather than hand-rolled look-alikes — use an `md-*` component wherever one exists.

- **Color**: MD3's official `--md-sys-color-*` tokens, defined in `:root` of `styles.css` — named exactly as `@material/web` expects so components pick up the theme automatically. Don't hand-pick new hex values; derive new roles the way M3 does (a container tone + an "on-container" text tone).
- **Type**: Roboto only, via `md-typescale-*` classes — no mixed font pairings.
- **Shape & elevation**: the `--md-sys-shape-corner-*` scale and `md-elevation` (via `--md-elevation-level`) stand in for ad hoc border-radius/shadow choices.
- **Semantic mapping**: the ideal/alternate variant chips (go/no-go flightseeing status) map onto M3's `primary` (ideal) and `error` (weathered-out) container roles via the `.tone-ideal`/`.tone-alternate` classes in `styles.css`, not custom colors.

### The three components `@material/web` doesn't have

`@material/web` has no Card, Carousel, or Side Sheet component (confirmed against the library's component list; it's also in maintenance mode with no active maintainers). Rather than reinvent them as bespoke-CSS lookalikes, each is approximated from real `md-*` primitives plus the minimum structural CSS to lay them out — this is the one deliberate exception to "no custom CSS," and it's confined to `styles.css`'s `day-surface`/`carousel-*`/`cards-grid`/`detail-side-sheet` rules:

- **Card / Carousel item** — a native `<button class="day-surface">` wrapping an `md-elevation` plus MD3 shape/color tokens (the same elevated-surface pattern MD3 itself uses for cards); the carousel and cards views render the *identical* item, differing only in the parent container's layout (`flex` + `scroll-snap-type: x mandatory` vs. `grid`).
- **Side sheet** — `<detail-side-sheet>` (`docs/js/side-sheet.js`), built from `md-elevation`, `md-icon-button`, `md-divider`, and `md-list`, positioned per the [M3 side-sheet spec](https://m3.material.io/components/side-sheets/overview): anchored to the trailing (right) edge, full height, rounded only on the inner corners, a scrim behind it, dismissed via the scrim, Escape, or the close button.

When touching styles, pull from the existing `--md-sys-*` tokens and reach for an `md-*` component first; only fall back to structural CSS for the three gaps above.

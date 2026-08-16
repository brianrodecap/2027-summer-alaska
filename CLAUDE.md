# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static itinerary site for a 2027 Alaska trip (national parks road/fly trip + a 7-night cruise), built entirely from real **Material Web Components** (`@material/web`, Google's MD3 component library) loaded buildless from a CDN — no framework, no bundler, no `npm install`. Everything under `docs/` is served as-is by GitHub Pages from `main`.

The site is a **read-only, drill-down presentation of a document-database-shaped trip data model** — `docs/data/2027-summer-alaska/*.json` (see `docs/data/data-model.html` for the full entity reference) — not a collection of hand-authored per-day files. There is no `Day` entity in the data; "what's happening on a given date" is computed at load time from `Stay`/`Transit`/`Activity`/`Note` timestamps, exactly as `data-model.html` describes.

- `docs/index.html` — page shell: hero, sticky nav tabs, section containers, dialogs
- `docs/styles.css` — the M3 color/shape tokens plus the minimal structural CSS `@material/web` doesn't provide (see "Design system")
- `docs/data/2027-summer-alaska/*.json` — the trip's own entities: `trip.json`, `legs.json`, `stays.json`, `transits.json`, `activities.json`, `scenarios.json`, `notes.json`. **This is the single source of truth for content** — see `docs/data/README.md` and `docs/data/data-model.html`.
- `docs/data/routes.json` — reference data shared across trips (currently empty — nothing in this trip needed a `Route`)
- `docs/js/trip-model.js` — loads the JSON and computes everything the model doesn't store: the Day view (per-date Stay/Transit/Activity/scenario-section grouping), Leg summaries, `Note.concerns` matching, and date/time/money formatting helpers
- `docs/js/day-render.js` — pure functions turning the computed Day/Leg/Activity views into DOM: `renderListItem`, `renderSurfaceItem` (shared by the carousel and cards views), `renderLegCard`, `renderDayDetailBody`, `renderLegDialogBody`, `renderActivityDetailBody`
- `docs/js/side-sheet.js` — the `<detail-side-sheet>` custom element (the one non-content component in the codebase)
- `docs/js/date-picker.js` — a docked calendar-grid date picker (`renderDatePicker`) for Overview's "Jump to a day" control
- `docs/js/places.js` / `docs/js/places-config.js` — live Google Places lookups for activities that name a real-world place
- `docs/js/app.js` — bootstraps everything: fetches the JSON, builds the computed view, populates Overview's Leg cards + the List/Carousel/Cards sections + the date picker, wires the Leg dialog → Day dialog → Activity side-sheet drill-down, drives the nav tabs

A private `data/2027-summer-alaska/attachments/` at the **repo root** (outside `docs/`, gitignored) holds the real booking PDFs those JSON files were hydrated from — never move that into `docs/`, since anything there is served publicly by GitHub Pages.

## Working with it

- Edit files directly; there is nothing to install or compile.
- Preview locally by serving `docs/` over HTTP, e.g. `python3 -m http.server 8934 --directory docs` then opening `http://localhost:8934/`. Opening `docs/index.html` directly via a `file://` URL does *not* work — browsers block both the ES module imports (`app.js`'s `import` statements) and the `fetch()` calls that load the JSON data under CORS from the `file:` origin. The `@material/web` import map points at `https://esm.run/@material/web/`, so a network connection is required even for local preview.
- Roboto and Material Symbols Outlined are loaded from Google Fonts via `<link>` tags in `<head>` — no local font files.
- Pushing to `main` updates the live GitHub Pages site directly; there is no staging/preview environment.

## Content structure — adding or editing content

There are no per-day files to edit — add or change documents in `docs/data/2027-summer-alaska/*.json` directly. See `docs/data/data-model.html` for the full schema; the common cases:

- **Add something happening on a date**: add a document to `activities.json` with `legId` and a real `startAt`/`endAt` timestamp (only fall back to `timeLabel` for genuinely fuzzy timing — Activity has no separate date field, so a timestamp is how it gets placed on a day). Optionally set `place` (a pinned Google Place ID, `{ id, label }`), `booking`, or `scenarioId`.
- **Add a weather-branch (ideal/alternate) day**: add two documents to `scenarios.json`, then set that `scenarioId` on every `Activity`/`Transit` for that date on each branch. The Day dialog automatically renders each distinct `scenarioId` present on a date as its own chip-headed section, in the JSON files' own array order (already narrative/chronological — nothing gets re-sorted by time).
- **Add a note, warning, or footnote**: add a document to `notes.json` with `concerns: Ref[]` pointing at whatever it's about. It surfaces automatically at the matching drill-down level — `entity: 'leg'` → the Leg dialog, a `date`/`dateRange`/`entity: 'stay'`/`entity: 'transit'` ref → the Day dialog, `entity: 'scenario'` → that date's matching scenario section, `entity: 'activity'` → that activity's side sheet.
- **Add a new Stay/Transit/Leg**: add to `stays.json`/`transits.json`/`legs.json` following the existing shapes; nothing else needs updating — `trip-model.js` picks it up automatically for whichever dates it overlaps.

One known gap, worth knowing about if it ever causes a day to render in the wrong place: a handful of activities (e.g. `act_jul7_1`) were migrated with neither `startAt` nor `endAt`. `trip-model.js` falls back to parsing the date out of the activity's own `_id` (`jul7` → `2027-07-07`) for those — new activities should just set `startAt`/`endAt` and never rely on this.

## Presentation: drill-down + three day views

Trip → Leg → Day → Activity, all computed from the same `view` object `trip-model.js` builds once at load:

- **Overview** (`#overview`) — trip travelers/date-range hero (derived from `trip.json`), Leg cards (one per `legs.json` entry) that open a **Leg dialog** (booking detail, leg-scoped notes, and a list of that leg's days), and a "Jump to a day" **date picker** (`#date-picker-dialog`, a month-at-a-time calendar grid — see `docs/js/date-picker.js`)
- **List** (`#view-list`) — an `md-list` of `md-list-item type="button"` rows, one per computed Day
- **Carousel** (`#view-carousel`) — a horizontally scrolling, scroll-snapped row of "day surface" items
- **Cards** (`#view-cards`) — the same "day surface" items in a responsive grid

List/Carousel/Cards rendering the same computed days three ways is a deliberate exploration to compare presentations, not a permanent design decision. Clicking any day (from any of the three views, the date picker, or a Leg dialog's day list) opens `#day-dialog` (a real `md-dialog`) with that day's Stay/Transit blocks, day-level notes, and activity sections. Clicking an activity row closes the dialog and opens `<detail-side-sheet>` with that activity's time/text/booking/notes, plus a live Places lookup if it names a real-world place. A dialog always closes whichever dialog/sheet opened it first — `md-dialog` renders in the browser's native top layer, which would otherwise always paint above the hand-positioned side sheet regardless of z-index, so a dialog and the side sheet never stack.

Both `#day-dialog` and `#leg-dialog` set `--md-dialog-container-max-height` **and** put `overflow-y: auto` directly on the `#*-dialog-body` content div — belt-and-suspenders, because without an explicit max-height a dialog just grows past the viewport with no scrollable region of its own, and a wheel-scroll over it silently falls through to scroll the page behind it instead.

## Design system

The site follows Google's **Material Design 3** spec directly, implemented with real `@material/web` components rather than hand-rolled look-alikes — use an `md-*` component wherever one exists.

- **Color**: MD3's official `--md-sys-color-*` tokens, defined in `:root` of `styles.css` — named exactly as `@material/web` expects so components pick up the theme automatically. Don't hand-pick new hex values; derive new roles the way M3 does (a container tone + an "on-container" text tone).
- **Type**: Roboto only, via `md-typescale-*` classes — no mixed font pairings.
- **Shape & elevation**: the `--md-sys-shape-corner-*` scale and `md-elevation` (via `--md-elevation-level`) stand in for ad hoc border-radius/shadow choices.
- **Semantic mapping**: the ideal/alternate variant chips (go/no-go flightseeing status) map onto M3's `primary` (ideal) and `error` (weathered-out) container roles via the `.tone-ideal`/`.tone-alternate` classes in `styles.css`, not custom colors.

### The four components `@material/web` doesn't have

`@material/web` has no Card, Carousel, Side Sheet, or Date Picker component (confirmed against the library's component list; it's also in maintenance mode with no active maintainers). Rather than reinvent them as bespoke-CSS lookalikes, each is approximated from real `md-*` primitives plus the minimum structural CSS to lay them out — this is the one deliberate exception to "no custom CSS," and it's confined to `styles.css`'s `day-surface`/`carousel-*`/`cards-grid`/`detail-side-sheet`/`date-picker-*` rules:

- **Card / Carousel item** — a native `<button class="day-surface">` wrapping an `md-elevation` plus MD3 shape/color tokens (the same elevated-surface pattern MD3 itself uses for cards); the carousel and cards views render the *identical* item, differing only in the parent container's layout (`flex` + `scroll-snap-type: x mandatory` vs. `grid`).
- **Side sheet** — `<detail-side-sheet>` (`docs/js/side-sheet.js`), built from `md-elevation`, `md-icon-button`, `md-divider`, and `md-list`, positioned per the [M3 side-sheet spec](https://m3.material.io/components/side-sheets/overview): anchored to the trailing (right) edge, full height, rounded only on the inner corners, a scrim behind it, dismissed via the scrim, Escape, or the close button.
- **Date picker** — `docs/js/date-picker.js`'s `renderDatePicker`, a docked month-grid calendar shown in `#date-picker-dialog` (a real `md-dialog`, following the same pattern as `#day-dialog`/`#leg-dialog`), built from `md-icon-button` for month navigation plus plain `<button>` day cells; only dates that land on an actual trip Day are selectable.

When touching styles, pull from the existing `--md-sys-*` tokens and reach for an `md-*` component first; only fall back to structural CSS for the four gaps above.

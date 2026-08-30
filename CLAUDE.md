# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A static itinerary site for upcoming trips — currently just a 2027 Alaska trip (national parks road/fly trip + a 7-night cruise) — built as a **React + TypeScript + MUI** single-page app, bundled with **Vite**. GitHub Actions (`.github/workflows/deploy.yml`) builds the app on every push to `main` and publishes the `dist/` output to GitHub Pages; there is no committed build output and no staging/preview environment.

The site is a **read-only, drill-down presentation of a document-database-shaped trip data model** — one directory per trip under `public/data/` (e.g. `public/data/2027-summer-alaska/*.json`; see `docs/data-model.html` for the full entity reference) — not a collection of hand-authored per-day files. There is no `Day` entity in the data; "what's happening on a given date" is computed at load time from `Stay`/`Transit`/`Activity`/`Note` timestamps, exactly as `data-model.html` describes.

- `public/data/trips.json` — the trips index: `[{ slug }, ...]`, one entry per sibling directory under `public/data/`
- `public/data/2027-summer-alaska/*.json` — this trip's own entities: `trip.json`, `legs.json`, `stays.json`, `transits.json`, `activities.json`, `scenarios.json`, `notes.json`. **This is the single source of truth for content.**
- `public/data/routes.json` — reference data shared across trips
- `docs/data-model.html`, `docs/README.md` — the schema reference and data-layout docs, kept as plain in-repo documentation (no longer built or served — `docs/` has no special meaning to GitHub Pages once Actions deploys from `dist/`)
- `src/model/tripModel.ts` — pure, framework-agnostic business logic (ported near-verbatim from the original vanilla-JS app): loads the JSON and computes everything the model doesn't store — the Day view (per-date Stay/Transit/Activity/scenario-track grouping), Leg summaries, `Note.concerns` matching, budget view, routed-Transit stage-time walking, and date/time/money formatting helpers. Does all date math on plain ISO strings, never `Date`/`dayjs` objects — see that file's own top-of-file note.
- `src/model/types.ts` — TypeScript re-expression of `docs/data-model.html`'s schema
- `src/model/{formatting,mealOptions,places,directions,editForms,exportEdits}.ts` — smaller pure-logic modules: vocabulary/label helpers, meal-option resolution, the Places/Routes REST wrappers, and the edit-form apply functions
- `src/state/{TripDataContext,TripSelectionsContext,EditContext}.tsx` — the trip's data (raw JSON + `useMemo(buildTripView)`), live UI selections (which scenario/route-variant/meal-option tab is active per day), and the edit-dialog wiring, respectively
- `src/routes/` — `TripsHome` (trips-list landing screen), `TripLayout` (shared hero + `<Outlet/>`), `Overview`, `DaysView`, `BudgetView` — routed via `react-router-dom`'s `createHashRouter` (`#/` → trips list, `#/<slug>` → overview, `#/<slug>/days[/<date>]`, `#/<slug>/budget`)
- `src/components/day/` — the Timeline-based day list: `DayBlock`, `DayTimeline` (maps `Day.sequence`/`ScenarioTrack.sequence` onto `@mui/lab` Timeline primitives), `ActivityRow`, `MealRow`, `RouteVariantTabs`, `ScenarioTabsSection` (+ `scenarioSelection.ts` for the follows/requires resolution), `DayMapPanel`
- `src/components/legs/` — `LegCard`, `LegDialog`
- `src/components/activity/` — `ActivityDetailPanel` (the activity side sheet body), `PlacePanel` + `usePlaceDetails` (live Google Places lookup)
- `src/components/edit/` — `EditDialog` + the four per-kind edit forms, `PlacePickerField` (MUI `Autocomplete` + `usePlaceSearch`), `MealOptionList`, `BookingFields`, `DateTimeFieldPair`
- `src/components/pickers/JumpToDayPicker.tsx` — the "Jump to a day" calendar, built on `@mui/x-date-pickers`' `DateCalendar`
- `src/components/shared/` — `DetailSideSheet` (MUI `Drawer`), `Notes`, `BookingChip`, `TravelerChips`, `TransitOverlapWarning`, `materialIcon.tsx` (the Material-Symbols-name → `@mui/icons-material` component registry every row/tab/dot icon draws from)
- `src/theme.ts` — the MUI theme (MD3 baseline palette ported from the old `--md-sys-color-*` tokens, plus a `container`/`onContainer` augmentation on `PaletteColor` so that MD3 tone-pair concept survives)

A private `data/2027-summer-alaska/attachments/` at the **repo root** (gitignored) holds the real booking PDFs those JSON files were hydrated from — never move that into `public/`, since anything there is served publicly by GitHub Pages.

The filter nav (booking/highlight/attention/leg filters over the day list, `src/model/filters.ts` + `src/components/day/FilterMenu.tsx`) and the standalone Routes-management dialog (`src/components/edit/RoutesDialog.tsx` + `RouteEditDialog.tsx` + `RouteEditForm.tsx`, for creating/editing `Route` reference documents directly — `TransitEditForm` still only _selects_ an existing route) have both been ported from `docs/js/filters.js` / the Route-editing half of `docs/js/edit.js`; both live as icon buttons in `DaysView`'s own sticky app bar, alongside "Jump to a day".

**Legacy files pending deletion:** `docs/index.html`, `docs/js/*.js`, `docs/styles.css` are the original buildless Material Web Components app, kept only until the GitHub Pages source is flipped to "GitHub Actions" (Settings → Pages) and the new build is confirmed live — delete them once that cutover is done.

## Working with it

- Node isn't necessarily on `PATH` in every shell on this machine — if `node`/`npm` aren't found, `source ~/.nvm/nvm.sh` first.
- Pushing to `main` triggers `.github/workflows/deploy.yml`, which builds and publishes to GitHub Pages — there is no staging/preview environment. The repo's Settings → Pages source must be set to "GitHub Actions" (not "Deploy from a branch") for this to take effect.
- `vite.config.ts`'s `base: '/2027-summer-alaska/'` must match the repo name exactly (case-sensitive) — this is a GitHub Pages _project_ page (`https://<owner>.github.io/2027-summer-alaska/`), not a user/org page. `npm run preview` does not reproduce this sub-path the same way the real deployed URL does; smoke-test against the live URL after a deploy, not just local preview.
- Roboto Serif is loaded from Google Fonts via a `<link>` tag in `index.html`'s `<head>` — no local font files. Icons come from `@mui/icons-material` (real React components, not a font/ligature icon set).

## Presentation: trips list → trip page → drill-down

`#/` is a **trips list** (`TripsHome`, reading `trips.json` + each trip's own `trip.json`); `#/<slug>` opens that trip into the shared **`TripLayout`** (hero + nested route `<Outlet/>`), built from the `view` object `tripModel.ts`'s `buildTripView` computes once per trip load (memoized on the raw `data`, so an edit's `setData` call is what triggers a recompute):

- The trip hero (`TripLayout`'s own `TripHero`) and **Leg cards** (`LegCard`, one per `legs.json` entry) that open a **`LegDialog`** — booking detail, leg-scoped notes, and a list of that leg's days.
- A budget teaser strip (`BudgetStrip`) linking to the dedicated `BudgetView` page (stat cards + By Leg/By Day/By Traveler tabs, see `src/components/budget/`).
- A "Jump to a day" **`JumpToDayPicker`** (an MUI `DateCalendar` in a `Dialog`).
- `DaysView` — every computed Day rendered inline via `DayBlock`/`DayTimeline`, full detail included (Stay/Transit nodes, day-level notes, scenario tab sections, activity rows), one sticky-headered block per day. There's no separate Day dialog: "jumping" to a day (from the Leg dialog's day list, the date picker, or a direct `/days/:date` URL) just scrolls that day's block into view.

Clicking an activity row opens `ActivityDetailPanel` (a `DetailSideSheet`, built on MUI `Drawer`) with that activity's time/text/booking/notes, plus a live Places lookup (`PlacePanel`/`usePlaceDetails`) if it names a real-world place.

Editing a Stay/Transit (via its row's pencil button) or an Activity (via the side sheet's edit button) opens `EditDialog`, hosting the matching form (`ActivityEditForm`/`StayEditForm`/`TransitEditForm`). There's no backend to save to — `EditContext`'s `onSave` mutates a `structuredClone` of the entity and commits it through `TripDataContext.setData`, which both triggers `buildTripView` to recompute and marks the touched collection dirty; the hero's download icon (visible only once something is dirty) exports the touched collection(s)' JSON for manual copy-back into `public/data/<slug>/`.

## Design system

The site follows Google's **Material Design 3** spec via real **MUI** (`@mui/material`) components, plus `@mui/lab`'s `Timeline` for the day list and `@mui/x-date-pickers` for the date/time pickers — use an MUI component wherever one exists rather than hand-rolling a look-alike.

- **Color**: `src/theme.ts`'s MUI theme carries the MD3 baseline palette (the same colors the old `--md-sys-color-*` tokens held) as `palette.primary/secondary/error/tertiary`, each augmented with a `container`/`onContainer` pair (MUI's own `PaletteColor` has no MD3-style container/on-container concept built in) plus a `palette.surfaceContainer` ladder. Derive new roles the same way — a container tone + an "on-container" text tone — rather than hand-picking new hex values.
- **Type**: Roboto Serif only, via `theme.typography.fontFamily` — no mixed font pairings.
- **Shape**: `theme.shape.borderRadius` (12, MD3's "medium" corner) stands in for ad hoc border-radius choices; components lean on MUI's own elevation (`Paper`/`Card`'s `elevation` prop) rather than hand-rolled shadows.
- **Icons**: every icon is a real `@mui/icons-material` component, looked up by its Material-Symbols name string through `src/components/shared/materialIcon.tsx`'s `materialIcon()` registry — add a new icon there rather than importing one ad hoc in a component, so the string-name-driven data (`Scenario.icon`, route-tone/dining-format vocab) keeps working.
- **Semantic mapping**: the ideal/alternate scenario tabs map onto MUI's `primary`/`error` palette roles (via `sx={{ color: ... }}` in `ScenarioTabsSection`), not custom colors.

### Components MUI doesn't have

MUI core plus `@mui/lab`/`@mui/x-date-pickers` covers nearly everything this site needs natively (`Card`, `Drawer` for the side sheet, `DateCalendar`/`DatePicker`/`TimeField` for both pickers, `AppBar`/`useScrollTrigger` for the sticky bar) — a major simplification over the previous Material Web Components setup, which was missing five of these and needed hand-built CSS for each. The one real gap:

- **Timeline** — `@mui/lab`'s `Timeline`/`TimelineItem`/`TimelineDot`/`TimelineConnector`/`TimelineContent` is the only MUI-family fit for the day list's "one connected line down the day" treatment; MUI core has no vertical-events-with-connector primitive. `@mui/lab` has stayed non-core (not semver-guaranteed) for years with no graduation date — all Timeline usage is confined to `src/components/day/DayTimeline.tsx`'s own node components (`StayNode`/`TransitBoundaryNode`/`TransitStageNode`/`SectionNode`/`ScenarioTabsNode`) rather than spread across many files, so a future breaking change only touches one layer.

When touching styles, pull from `theme.ts`'s palette/shape tokens and reach for an MUI component first; only fall back to custom `sx`/CSS for genuine one-offs (the sticky day-block headers' `position: sticky` layout, mainly).
